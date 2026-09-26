export type StreamStatus =
  | 'idle'
  | 'connecting'
  | 'playing'
  | 'reconnecting'
  | 'gesture-needed'
  | 'error';

export interface StreamInfo {
  status: StreamStatus;
  /** Scheduled audio ahead of the render clock, in ms. */
  latencyMs: number;
  /** Signed error of the last frame's PTS step against the nominal rate. */
  driftMs: number;
  /** Frames lost on the wire (detected from PTS steps). */
  gaps: number;
  /** Frames discarded because the AudioContext could not keep up. */
  drops: number;
  /** AudioContext output latency, which delays what the user actually hears. */
  outputLatencyMs: number;
  error: string | null;
}

/**
 * Who asked for the stream. 'user' means a person tapped a control; 'auto'
 * means the host told us to (broadcast hotkey, or the polling fallback).
 */
export type StreamSource = 'user' | 'auto';

type Listener = (info: StreamInfo) => void;

const listeners = new Set<Listener>();
let deviceId = '';

export function setDeviceId(id: string) {
  deviceId = id;
}

function readUint64BE(dv: DataView, offset: number): number {
  const hi = dv.getUint32(offset);
  const lo = dv.getUint32(offset + 4);
  return hi * 4294967296 + lo;
}

const FRAME_SAMPLES = 2048;
const FRAME_MS = (FRAME_SAMPLES * 1000) / 48000; // 42.667
const BATCH_FRAMES = 3;

/** First batch is scheduled this far after the PTS of its first frame. */
const TARGET_DELAY = 500;
/** Steady-state amount of audio kept scheduled ahead of the render clock. */
const TARGET_BUFFER = 0.35; // seconds
/**
 * Hard ceiling on scheduled-ahead audio. Past this the stream re-anchors:
 * better a short discontinuity than latency that grows for the rest of the
 * session. Without it, any stall permanently offsets this device from the
 * others, because the drift compensator cannot drain a backlog in usable time.
 */
const MAX_LATENCY = 0.75; // seconds
/** Frames retained while the AudioContext is suspended (autoplay blocked). */
const MAX_PENDING = 24; // ~1.0 s

/**
 * Drift compensator, retuned in seconds rather than milliseconds. The previous
 * gains needed a 375 ms error before the proportional term saturated and capped
 * total authority at 0.3 %, which drains 50 ms in ~167 s. At these gains a 50 ms
 * error reaches full authority in about 2.5 s.
 */
const PI_KP = 0.3; // rate change per second of error
const PI_KI = 0.01; // rate change per second-squared, via the integral
const PI_MAX = 0.02; // 2 % playback-rate authority
const PI_INTEGRAL_LIMIT = 1.0; // seconds

const FADE_SEC = 0.002;

/**
 * Offsets the anchor by the AudioContext output latency so the moment the
 * user *hears* a frame matches the moment the other devices hear it. Capped,
 * because a pathological reported latency should not add unbounded delay.
 */
const COMPENSATE_OUTPUT_LATENCY = true;
const MAX_OUTPUT_LATENCY = 0.5; // seconds

const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 15000;
const NTP_PINGS = 10;
const INIT_TIMEOUT = 10000;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Reads AudioContext.state through `string` so control-flow analysis does not
 * narrow it across an await: `ctx.resume()` mutates the state asynchronously
 * and the compiler cannot see that.
 */
function stateOf(ctx: AudioContext): string {
  return ctx.state as string;
}

class SyncedAudioPlayer {
  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;

  private active = false;
  private connecting = false;
  /** Desired state. Distinguishes "should be streaming" from "is streaming". */
  private wantActive = false;
  /**
   * True when a human asked for this stream, as opposed to a host-driven
   * auto-join. Auto-started streams follow the host's broadcast lifecycle;
   * manually started ones must not be torn down or restarted underneath the
   * user by a background poll.
   */
  private userIntent = false;

  private clockOffset = 0;
  private perfBase = 0;
  private dateBase = 0;

  private sampleRate = 48000;
  private channels = 2;
  private bytesPerSample = 2;

  private ntpOffsets: number[] = [];
  private ntpResolve: (() => void) | null = null;

  /**
   * Frames waiting to become an AudioBuffer, one entry per frame per channel.
   * Held as a list rather than a growing merged buffer: merging copied the
   * whole accumulator on every frame, which is quadratic and unbounded while
   * the context is suspended.
   */
  private pending: Float32Array[][] = [];
  private batchFirstPTS = 0;
  private lastPTS = 0;

  private scheduledEnd = 0;
  private currentRate = 1.0;
  private integralError = 0;
  private reanchor = true;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  // Kept across reconnect attempts: retrying with a blank "Retrying" label
  // hides the actual cause (e.g. ffmpeg missing) behind a spinner.
  private lastFailure: string | null = null;

  private info: StreamInfo = {
    status: 'idle',
    latencyMs: 0,
    driftMs: 0,
    gaps: 0,
    drops: 0,
    outputLatencyMs: 0,
    error: null,
  };

  hostTimeMs(): number {
    return performance.now() - this.perfBase + this.dateBase + this.clockOffset;
  }

  private setStatus(status: StreamStatus, error: string | null = null) {
    if (this.info.status === status && this.info.error === error) return;
    this.info = { ...this.info, status, error };
    this.notify();
  }

  private notify() {
    const snapshot = { ...this.info };
    listeners.forEach((cb) => cb(snapshot));
  }

  private outputLatency(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const anyCtx = ctx as AudioContext & { outputLatency?: number };
    const v = anyCtx.outputLatency ?? ctx.baseLatency ?? 0;
    return Number.isFinite(v) ? v : 0;
  }

  private pcmToFloat(data: ArrayBuffer): Float32Array[] {
    const int16 = new Int16Array(data);
    const per = Math.floor(int16.length / this.channels);
    const out: Float32Array[] = [];
    for (let ch = 0; ch < this.channels; ch++) {
      const c = new Float32Array(per);
      for (let i = 0; i < per; i++) {
        c[i] = int16[i * this.channels + ch] / 32768;
      }
      out.push(c);
    }
    return out;
  }

  /**
   * Consume the pending frames as one AudioBuffer and schedule it. When the
   * AudioContext is not running the frames are simply dropped past the cap, so
   * a browser that blocks autoplay costs a bounded amount of memory instead of
   * growing without limit until the tab is killed.
   */
  private flushBatch() {
    const ctx = this.ctx;
    if (!ctx || this.pending.length === 0) return;

    if (stateOf(ctx) !== 'running') {
      // Autoplay is blocked. Keep only the most recent MAX_PENDING frames so
      // memory stays bounded while the user decides whether to tap.
      const excess = Math.max(0, this.pending.length - MAX_PENDING);
      if (excess > 0) {
        this.pending.splice(0, excess);
        this.info = { ...this.info, drops: this.info.drops + excess };
      }
      this.info = {
        ...this.info,
        outputLatencyMs: Math.round(this.outputLatency() * 1000),
      };
      this.setStatus('gesture-needed');
      this.notify();
      return;
    }

    const totalFrames = this.pending.length * FRAME_SAMPLES;
    const buffer = ctx.createBuffer(this.channels, totalFrames, this.sampleRate);
    let off = 0;
    for (const frame of this.pending) {
      for (let ch = 0; ch < this.channels; ch++) {
        buffer.getChannelData(ch).set(frame[ch], off);
      }
      off += FRAME_SAMPLES;
    }
    this.pending = [];

    let ctxTime: number;
    const anchor = this.scheduledEnd === 0 || this.reanchor;

    if (anchor) {
      this.currentRate = 1.0;
      this.integralError = 0;
      this.reanchor = false;

      const outLat = COMPENSATE_OUTPUT_LATENCY
        ? Math.min(this.outputLatency(), MAX_OUTPUT_LATENCY)
        : 0;
      const targetPlay = this.batchFirstPTS + TARGET_DELAY + outLat * 1000;
      const delay = targetPlay - this.hostTimeMs();
      if (delay < 0) {
        // PTS already behind us (wake from sleep, long stall). Re-seed from
        // now instead of discarding forever while PTS runs ahead.
        ctxTime = ctx.currentTime + 0.02;
        this.batchFirstPTS = this.hostTimeMs();
      } else {
        ctxTime = ctx.currentTime + delay / 1000;
      }
    } else {
      const ahead = this.scheduledEnd - ctx.currentTime;
      const err = ahead - TARGET_BUFFER;
      this.integralError = clamp(
        this.integralError + err * 0.05,
        -PI_INTEGRAL_LIMIT,
        PI_INTEGRAL_LIMIT,
      );
      const adj = clamp(err * PI_KP + this.integralError * PI_KI, -PI_MAX, PI_MAX);
      this.currentRate = 1.0 + adj;
      ctxTime = this.scheduledEnd;

      if (ctxTime - ctx.currentTime > MAX_LATENCY) {
        // Too far ahead: re-anchor rather than accumulate latency forever.
        ctxTime = ctx.currentTime + 0.05;
        this.scheduledEnd = 0;
        this.reanchor = true;
      }
    }

    const duration = totalFrames / (this.sampleRate * this.currentRate);
    const startTime = ctxTime;
    const endTime = ctxTime + duration;

    if (startTime < ctx.currentTime - 0.001) {
      // We fell behind (throttled tab, GC pause). Play immediately and
      // re-anchor so the error cannot compound.
      this.info = { ...this.info, drops: this.info.drops + 1 };
      this.reanchor = true;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.currentRate;

    const gain = ctx.createGain();
    const fadeEnd = Math.max(startTime + FADE_SEC, endTime - FADE_SEC);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + FADE_SEC);
    gain.gain.setValueAtTime(1, fadeEnd);
    gain.gain.linearRampToValueAtTime(0, endTime);

    source.connect(gain);
    gain.connect(ctx.destination);
    try {
      source.start(startTime);
    } catch {
      this.scheduledEnd = 0;
      this.reanchor = true;
      return;
    }

    this.scheduledEnd = endTime;
    this.info = {
      ...this.info,
      latencyMs: Math.round((endTime - ctx.currentTime) * 1000),
      outputLatencyMs: Math.round(this.outputLatency() * 1000),
    };
    if (this.info.status !== 'playing') {
      this.setStatus('playing');
    } else {
      this.notify();
    }
  }

  private feedFrame(pts: number, pcm: ArrayBuffer) {
    if (!this.ctx || !this.active) return;

    // Use the PTS we are sent. A step that is not one frame means a frame was
    // lost or duplicated on the wire; either way the timeline has a hole and
    // continuing to append would silently shift this device out of sync with
    // every other one, permanently.
    if (this.lastPTS !== 0) {
      const step = pts - this.lastPTS;
      this.info = { ...this.info, driftMs: Math.round(step - FRAME_MS) };
      if (step < FRAME_MS * 0.5) {
        // Duplicate or reordered frame — discard it.
        this.info = { ...this.info, drops: this.info.drops + 1 };
        this.notify();
        return;
      }
      if (step > FRAME_MS * 1.5) {
        // A gap. Re-anchor so latency stays bounded.
        this.info = { ...this.info, gaps: this.info.gaps + 1 };
        this.reanchor = true;
      }
    }
    this.lastPTS = pts;

    if (this.pending.length === 0) this.batchFirstPTS = pts;
    this.pending.push(this.pcmToFloat(pcm));

    while (this.pending.length > MAX_PENDING) {
      this.pending.shift();
      this.info = { ...this.info, drops: this.info.drops + 1 };
    }

    if (this.pending.length >= BATCH_FRAMES) this.flushBatch();
  }

  /**
   * Resume a context that autoplay left suspended. Called by the stream
   * control when the user taps it while in the gesture-needed state, so the
   * control is the unlock target instead of only working elsewhere on the page.
   */
  unlock(): void {
    const ctx = this.ctx;
    if (!ctx || stateOf(ctx) === 'running') return;
    ctx
      .resume()
      .then(() => {
        if (stateOf(ctx) === 'running') {
          this.reanchor = true;
          this.scheduledEnd = 0;
          this.setStatus(this.active ? 'playing' : 'idle');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('audio-unlocked'));
          }
        }
      })
      .catch(() => {
        /* still blocked; the next gesture will try again */
      });
  }

  /** Report that a user gesture is required before audio can start. */
  private notifyGestureNeeded() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('audio-needs-gesture'));
    }
    this.setStatus('gesture-needed');
  }

  async start(source: StreamSource = 'user') {
    this.wantActive = true;
    if (source === 'user') this.userIntent = true;
    this.cancelReconnect();
    if (this.active || this.connecting) return; // one socket, ever

    this.connecting = true;
    this.info = { ...this.info, error: null };
    this.setStatus('connecting');

    let ctx = this.ctx;
    if (!ctx || stateOf(ctx) === 'closed') {
      try {
        ctx = new AudioContext({ sampleRate: 48000 });
      } catch {
        ctx = new AudioContext();
      }
      this.ctx = ctx;
    }

    this.pending = [];
    this.scheduledEnd = 0;
    this.reanchor = true;
    this.lastPTS = 0;
    this.currentRate = 1.0;
    this.integralError = 0;

    if (stateOf(ctx) === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* blocked; the module-level gesture listeners will resume it */
      }
      if (stateOf(ctx) !== 'running') this.notifyGestureNeeded();
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/api/audio-stream/ws${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`;
    const w = new WebSocket(url);
    w.binaryType = 'arraybuffer';
    this.ws = w;

    try {
      await this.handleConnection(w, ctx);
      this.connecting = false;
      this.reconnectAttempts = 0;
      this.lastFailure = null;
    } catch (e) {
      this.connecting = false;
      if (w === this.ws) this.ws = null;
      const reason = e instanceof Error ? e.message : String(e);
      this.lastFailure = reason;
      this.setStatus('error', reason);
      if (this.wantActive) this.scheduleReconnect();
    }
  }

  private handleConnection(w: WebSocket, ctx: AudioContext): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('no audio from host (init timeout)')),
        INIT_TIMEOUT,
      );
      let settled = false;
      const fail = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(msg));
      };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      w.onmessage = (e) => {
        if (w !== this.ws) return; // superseded by a newer socket
        if (typeof e.data === 'string') {
          let msg: any = null;
          try {
            msg = JSON.parse(e.data);
          } catch {
            return;
          }
          if (msg?.type === 'ntp_pong') this.handleNtpPong(msg, w);
          if (msg?.type === 'error') {
            fail(msg.message || msg.reason || 'host reported a capture error');
          }
          return;
        }

        const dv = new DataView(e.data);
        if (dv.getUint8(0) !== 0x01) return;

        this.sampleRate = dv.getUint32(1);
        this.channels = dv.getUint8(5);
        this.bytesPerSample = dv.getUint8(6);

        if (stateOf(ctx) === 'suspended') this.notifyGestureNeeded();

        this.startNtp(w)
          .then(() => {
            if (w !== this.ws) return fail('superseded');
            // Frames are buffered from here on, but if the context is still
            // suspended nothing is audible — say so instead of claiming to play.
            this.active = true;
            this.connecting = false;
            this.setMediaSession();
            this.setStatus(
              stateOf(ctx) === 'running' ? 'playing' : 'gesture-needed',
            );
            done();
          })
          .catch((err) => fail(err instanceof Error ? err.message : 'clock sync failed'));

        // Hand audio handling over now; frames arriving before the clock is
        // synced are intentionally dropped so we do not schedule against an
        // unknown offset.
        w.onmessage = (ev) => {
          if (w !== this.ws) return;
          if (typeof ev.data === 'string') {
            let m: any = null;
            try {
              m = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (m?.type === 'ntp_pong') this.handleNtpPong(m, w);
            if (m?.type === 'error') {
              this.active = false;
              this.lastFailure = m.message || m.reason || 'capture stopped';
              this.setStatus('error', this.lastFailure);
            }
            return;
          }
          const inner = new DataView(ev.data);
          if (inner.getUint8(0) === 0x02) {
            this.feedFrame(readUint64BE(inner, 1), ev.data.slice(9));
          }
        };
      };

      w.onerror = () => fail('websocket error — is the host running?');

      w.onclose = () => {
        if (w !== this.ws) return; // a newer socket owns the stream now
        this.ws = null;
        this.connecting = false;
        const wasActive = this.active;
        this.active = false;
        this.pending = [];
        this.scheduledEnd = 0;
        this.reanchor = true;
        this.lastPTS = 0;
        if (this.info.status === 'error') return;
        this.setStatus(wasActive ? 'reconnecting' : 'connecting');
        if (this.wantActive) this.scheduleReconnect();
      };
    });
  }

  private setMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const ms = navigator as any;
      ms.mediaSession.metadata = new (window as any).MediaMetadata({
        title: 'Control Deck — Laptop Audio',
        artist: 'Live stream',
        album: 'Tab Dashboard',
      });
      ms.mediaSession.playbackState = 'playing';
      ms.mediaSession.setActionHandler('stop', () => this.stop());
      ms.mediaSession.setActionHandler('pause', () => this.stop());
      ms.mediaSession.setActionHandler('play', () => this.start('user'));
    } catch {
      /* not all browsers support every action handler */
    }
  }

  private startNtp(w: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ntpOffsets = [];
      this.ntpResolve = resolve;
      this.sendNextNtp(w);
      setTimeout(
        () => reject(new Error('clock sync timed out')),
        8000,
      );
    });
  }

  private sendNextNtp(w: WebSocket) {
    if (this.ntpOffsets.length >= NTP_PINGS) {
      this.finalizeNtp();
      return;
    }
    w.send(JSON.stringify({ type: 'ntp_ping', t1: Date.now() }));
  }

  private handleNtpPong(msg: { t1: number; t2: number }, w: WebSocket) {
    const t3 = Date.now();
    const rtt = t3 - msg.t1;
    const offset = msg.t2 - msg.t1 - rtt / 2;
    this.ntpOffsets.push(offset);

    if (this.ntpOffsets.length < NTP_PINGS) {
      setTimeout(() => {
        if (w.readyState === WebSocket.OPEN) this.sendNextNtp(w);
      }, 10);
    } else {
      this.finalizeNtp();
    }
  }

  private finalizeNtp() {
    const sorted = [...this.ntpOffsets].sort((a, b) => a - b);
    const trimmed = sorted.slice(2, -2);
    const sum = trimmed.reduce((s, v) => s + v, 0);
    this.clockOffset = trimmed.length ? sum / trimmed.length : 0;
    this.perfBase = performance.now();
    this.dateBase = Date.now();

    const r = this.ntpResolve;
    this.ntpResolve = null;
    if (r) r();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return;
    const base = Math.min(RECONNECT_MAX, RECONNECT_BASE * 2 ** this.reconnectAttempts);
    const delay = base + Math.random() * 400;
    this.reconnectAttempts++;
    this.setStatus('reconnecting', this.lastFailure);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantActive) this.start(this.userIntent ? 'user' : 'auto');
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  stop(source: StreamSource = 'user') {
    this.wantActive = false;
    if (source === 'user') this.userIntent = false;
    this.cancelReconnect();

    this.active = false;
    this.connecting = false;
    this.pending = [];
    this.scheduledEnd = 0;
    this.reanchor = true;
    this.lastPTS = 0;
    this.reconnectAttempts = 0;
    this.lastFailure = null;
    this.info = {
      ...this.info,
      error: null,
      latencyMs: 0,
      driftMs: 0,
    };

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        const ms = navigator as any;
        ms.mediaSession.playbackState = 'none';
        ms.mediaSession.metadata = null;
      } catch {
        /* ignore */
      }
    }

    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      w.onmessage = null;
      w.onclose = null;
      w.onerror = null;
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }

    if (this.ctx) {
      // Keep the context so a hotkey-triggered start does not need a fresh
      // gesture; a previously unlocked context resumes without one.
      try {
        this.ctx.suspend();
      } catch {
        /* ignore */
      }
      if (stateOf(this.ctx) === 'closed') this.ctx = null;
    }

    this.setStatus('idle');
  }

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    cb({ ...this.info });
    return () => {
      listeners.delete(cb);
    };
  }

  isActive(): boolean {
    return this.active;
  }

  /** True when the current stream was requested by a person, not auto-joined. */
  isUserDriven(): boolean {
    return this.userIntent && this.wantActive;
  }

  getInfo(): StreamInfo {
    return { ...this.info };
  }
}

const player = new SyncedAudioPlayer();

/**
 * Module-level gesture unlock. If the AudioContext is suspended because the
 * browser blocked autoplay, any interaction resumes it, so a hotkey-triggered
 * broadcast does not need a second tap.
 */
if (typeof document !== 'undefined') {
  const tryGlobalResume = () => {
    const ctx = (player as any).ctx as AudioContext | null;
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  document.addEventListener('click', tryGlobalResume, { passive: true });
  document.addEventListener('touchend', tryGlobalResume, { passive: true });
  document.addEventListener('keydown', tryGlobalResume, { passive: true });
}

export function start(source: StreamSource = 'user') {
  player.start(source);
}
export function stop(source: StreamSource = 'user') {
  player.stop(source);
}
export function subscribe(cb: Listener) {
  return player.subscribe(cb);
}
export function isActive() {
  return player.isActive();
}
export function isUserDriven() {
  return player.isUserDriven();
}
export function unlock() {
  player.unlock();
}
export function getInfo() {
  return player.getInfo();
}
export type { StreamInfo as AudioStreamInfo };
