const DEFAULT_FREQUENCY = 19500;
const RAMP_DURATION = 0.05;

type TransmitterState = 'idle' | 'starting' | 'playing' | 'stopping';

export class AcousticTransmitter {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private state: TransmitterState = 'idle';
  private freq: number = DEFAULT_FREQUENCY;

  onStateChange?: (state: TransmitterState) => void;

  get frequency() { return this.freq; }
  get playing() { return this.state === 'playing'; }

  setFrequency(hz: number) {
    this.freq = Math.max(18000, Math.min(20000, hz));
    if (this.osc) this.osc.frequency.setValueAtTime(this.freq, this.ctx!.currentTime);
  }

  async start() {
    if (this.state === 'playing' || this.state === 'starting') return;

    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.state = 'starting';
    this.onStateChange?.(this.state);

    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.frequency.setValueAtTime(this.freq, this.ctx.currentTime);

    this.gain = this.ctx.createGain();
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + RAMP_DURATION);

    this.osc.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.osc.start();

    this.state = 'playing';
    this.onStateChange?.(this.state);
  }

  stop() {
    if (this.state !== 'playing') return;
    this.state = 'stopping';
    this.onStateChange?.(this.state);

    const ctx = this.ctx!;
    const gain = this.gain!;
    const osc = this.osc!;

    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + RAMP_DURATION);

    setTimeout(() => {
      try { osc.stop(); } catch {}
      try { ctx.close(); } catch {}
      this.osc = null;
      this.gain = null;
      this.ctx = null;
      this.state = 'idle';
      this.onStateChange?.(this.state);
    }, RAMP_DURATION * 1000 + 50);
  }

  destroy() {
    if (this.state === 'playing') this.stop();
    else {
      try { this.ctx?.close(); } catch {}
      this.osc = null;
      this.gain = null;
      this.ctx = null;
      this.state = 'idle';
    }
  }
}
