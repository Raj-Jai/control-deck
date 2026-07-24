type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();

function readUint64BE(dv: DataView, offset: number): number {
  const hi = dv.getUint32(offset);
  const lo = dv.getUint32(offset + 4);
  return hi * 4294967296 + lo;
}

const FRAME_SAMPLES = 2048;
const BATCH_FRAMES = 3;
const TARGET_DELAY = 500;
const TARGET_BUFFER = 350;

const PI_KP = 0.000008;
const PI_KI = 0.0000003;
const PI_MAX = 0.003;
const PI_INTEGRAL_LIMIT = 500;

const FADE_SEC = 0.002;

class SyncedAudioPlayer {
  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private active = false;

  private clockOffset = 0;
  private perfBase = 0;
  private dateBase = 0;

  private sampleRate = 48000;
  private channels = 2;
  private bytesPerSample = 2;

  private ntpResolve: (() => void) | null = null;
  private ntpOffsets: number[] = [];

  private accChannels: Float32Array[] = [];
  private accFrames = 0;
  private firstBatchPTS = 0;

  private scheduledEnd = 0;
  private currentRate = 1.0;
  private integralError = 0;

  hostTimeMs(): number {
    return (performance.now() - this.perfBase) + this.dateBase + this.clockOffset;
  }

  private notify() {
    listeners.forEach(cb => cb(this.active));
  }

  private pcmToFloat(data: ArrayBuffer): Float32Array[] {
    const int16 = new Int16Array(data);
    const samplesPerChannel = int16.length / this.channels;
    const result: Float32Array[] = [];
    for (let ch = 0; ch < this.channels; ch++) {
      const channel = new Float32Array(samplesPerChannel);
      for (let i = 0; i < samplesPerChannel; i++) {
        channel[i] = int16[i * this.channels + ch] / 32768;
      }
      result.push(channel);
    }
    return result;
  }

  private flushBatch() {
    if (!this.ctx || this.accFrames === 0) return;

    const totalFrames = this.accFrames * FRAME_SAMPLES;
    const buffer = this.ctx.createBuffer(this.channels, totalFrames, this.sampleRate);
    for (let ch = 0; ch < this.channels; ch++) {
      buffer.getChannelData(ch).set(this.accChannels[ch]);
    }

    let ctxTime: number;
    let duration: number;

    if (this.scheduledEnd === 0) {
      this.currentRate = 1.0;
      this.integralError = 0;
      const targetPlay = this.firstBatchPTS + TARGET_DELAY;
      const now = this.hostTimeMs();
      const delay = targetPlay - now;
      if (delay < 0) {
        this.accFrames = 0;
        return;
      }
      ctxTime = this.ctx.currentTime + delay / 1000;
      duration = totalFrames / this.sampleRate;
    } else {
      const bufferAheadMs = (this.scheduledEnd - this.ctx.currentTime) * 1000;
      const error = bufferAheadMs - TARGET_BUFFER;
      this.integralError = Math.max(-PI_INTEGRAL_LIMIT,
        Math.min(PI_INTEGRAL_LIMIT,
          this.integralError + error * 0.05));
      let adj = error * PI_KP + this.integralError * PI_KI;
      adj = Math.max(-PI_MAX, Math.min(PI_MAX, adj));
      this.currentRate = 1.0 + adj;

      duration = totalFrames / (this.sampleRate * this.currentRate);
      ctxTime = this.scheduledEnd;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.currentRate;

    const gain = this.ctx.createGain();
    const startTime = ctxTime;
    const endTime = ctxTime + duration;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + FADE_SEC);
    gain.gain.setValueAtTime(1, endTime - FADE_SEC);
    gain.gain.linearRampToValueAtTime(0, endTime);

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start(startTime);

    this.scheduledEnd = endTime;
    this.accFrames = 0;
  }

  private feedFrame(pts: number, pcm: ArrayBuffer) {
    if (!this.ctx || !this.active) return;

    const channels = this.pcmToFloat(pcm);

    if (this.accFrames === 0) {
      this.firstBatchPTS = pts;
      this.accChannels = channels.map(c => new Float32Array(c));
    } else {
      for (let ch = 0; ch < this.channels; ch++) {
        const old = this.accChannels[ch];
        const n = old.length + channels[ch].length;
        const merged = new Float32Array(n);
        merged.set(old);
        merged.set(channels[ch], old.length);
        this.accChannels[ch] = merged;
      }
    }
    this.accFrames++;

    if (this.accFrames >= BATCH_FRAMES) {
      this.flushBatch();
    }
  }

  async start() {
    if (this.active) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 48000 });
    } catch {
      ctx = new AudioContext();
    }
    this.ctx = ctx;
    this.accFrames = 0;
    this.scheduledEnd = 0;
    this.currentRate = 1.0;
    this.integralError = 0;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const w = new WebSocket(`${proto}//${location.host}/api/audio-stream/ws`);
    w.binaryType = 'arraybuffer';
    this.ws = w;

    try {
      await this.handleConnection(w, ctx);
    } catch {
      this.stop();
    }
  }

  private handleConnection(w: WebSocket, ctx: AudioContext): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('init timeout')), 10000);

      w.onmessage = (e) => {
        if (typeof e.data === 'string') {
          const msg = JSON.parse(e.data);
          if (msg.type === 'ntp_pong') {
            this.handleNtpPong(msg);
          }
          return;
        }

        const dv = new DataView(e.data);
        const type = dv.getUint8(0);

        if (type === 0x01) {
          this.sampleRate = dv.getUint32(1);
          this.channels = dv.getUint8(5);
          this.bytesPerSample = dv.getUint8(6);

          if (ctx.state === 'suspended') {
            ctx.resume();
          }

          this.startNtp(w).then(() => {
            clearTimeout(timeout);
            this.active = true;
            this.notify();

            w.onmessage = (ev) => {
              if (typeof ev.data === 'string') {
                const m = JSON.parse(ev.data);
                if (m.type === 'ntp_pong') {
                  this.handleNtpPong(m);
                }
                return;
              }
              const innerDv = new DataView(ev.data);
              if (innerDv.getUint8(0) === 0x02) {
                const pts = readUint64BE(innerDv, 1);
                this.feedFrame(pts, ev.data.slice(9));
              }
            };

            resolve();
          }).catch(reject);
        }
      };

      w.onerror = () => reject(new Error('ws error'));
      w.onclose = () => {
        if (!this.active) reject(new Error('ws closed'));
      };
    });
  }

  private startNtp(w: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      this.ntpOffsets = [];
      this.ntpResolve = resolve;
      this.sendNextNtp(w);
    });
  }

  private sendNextNtp(w: WebSocket) {
    if (this.ntpOffsets.length >= 10) {
      this.finalizeNtp();
      return;
    }
    const t1 = Date.now();
    w.send(JSON.stringify({ type: 'ntp_ping', t1 }));
  }

  private handleNtpPong(msg: { t1: number; t2: number }) {
    const t3 = Date.now();
    const rtt = t3 - msg.t1;
    const offset = msg.t2 - msg.t1 - rtt / 2;
    this.ntpOffsets.push(offset);

    if (this.ntpOffsets.length < 10 && this.ws) {
      setTimeout(() => this.sendNextNtp(this.ws!), 10);
    } else if (this.ntpOffsets.length >= 10) {
      this.finalizeNtp();
    }
  }

  private finalizeNtp() {
    const sorted = [...this.ntpOffsets].sort((a, b) => a - b);
    const avg = sorted.slice(2, -2).reduce((s, v) => s + v, 0) / Math.max(sorted.length - 4, 1);

    this.clockOffset = avg;
    this.perfBase = performance.now();
    this.dateBase = Date.now();

    if (this.ntpResolve) {
      this.ntpResolve();
      this.ntpResolve = null;
    }
  }

  stop() {
    if (this.accFrames > 0) {
      this.flushBatch();
    }
    this.active = false;
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.accFrames = 0;
    this.notify();
  }

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    cb(this.active);
    return () => { listeners.delete(cb); };
  }

  isActive(): boolean {
    return this.active;
  }
}

const player = new SyncedAudioPlayer();

export function start() { player.start(); }
export function stop() { player.stop(); }
export function subscribe(cb: Listener) { return player.subscribe(cb); }
export function isActive() { return player.isActive(); }
