type Listener = (active: boolean) => void;

const listeners = new Set<Listener>();

function readUint64BE(dv: DataView, offset: number): number {
  const hi = dv.getUint32(offset);
  const lo = dv.getUint32(offset + 4);
  return hi * 4294967296 + lo;
}

class SyncedAudioPlayer {
  private ctx: AudioContext | null = null;
  private ws: WebSocket | null = null;
  private active = false;

  private clockOffset = 0;
  private perfBase = 0;
  private dateBase = 0;

  private sampleRate = 44100;
  private channels = 2;
  private bytesPerSample = 2;

  private targetDelay = 400;

  private destroyed = false;
  private ntpResolve: (() => void) | null = null;
  private ntpOffsets: number[] = [];

  hostTimeMs(): number {
    return (performance.now() - this.perfBase) + this.dateBase + this.clockOffset;
  }

  private notify() {
    listeners.forEach(cb => cb(this.active));
  }

  private cleanupWS(prevWs: WebSocket) {
    prevWs.onmessage = null;
    prevWs.onclose = null;
    prevWs.onerror = null;
    prevWs.close();
  }

  private processPCM(data: ArrayBuffer): Float32Array[] {
    const int16 = new Int16Array(data, 0, Math.floor(data.byteLength / 2));
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

  private scheduleFrame(pts: number, pcm: ArrayBuffer) {
    if (!this.ctx || !this.active) return;

    const targetPlay = pts + this.targetDelay;
    const now = this.hostTimeMs();
    const delay = targetPlay - now;

    if (delay < 0) return;

    const channels = this.processPCM(pcm);
    const frames = channels[0].length;

    const audioBuffer = this.ctx.createBuffer(this.channels, frames, this.sampleRate);
    for (let ch = 0; ch < this.channels; ch++) {
      audioBuffer.getChannelData(ch).set(channels[ch]);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const ctxTime = this.ctx.currentTime + delay / 1000;
    source.start(ctxTime);
  }

  async start() {
    if (this.active) return;
    this.destroyed = false;

    const ctx = new AudioContext();
    this.ctx = ctx;

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
                this.scheduleFrame(pts, ev.data.slice(9));
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
    this.destroyed = true;
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
