const FFT_SIZE = 2048;
const SAMPLE_INTERVAL = 100;
const MOVING_AVG_WINDOW = 10;
const CALIB_DURATION_MS = 2000;
const HYSTERESIS_HIGH_COUNT = 3;
const HYSTERESIS_LOW_COUNT = 5;

export type ProximityState = 'unknown' | 'in_room' | 'out_of_room';
export type ReceiverState = 'idle' | 'calibrating' | 'listening' | 'error';

export interface AcousticReceiverConfig {
  targetFrequency?: number;
  /** Raw byte threshold above noise floor to confirm IN_ROOM (default: 80) */
  highThreshold?: number;
  /** Raw byte threshold above noise floor to confirm OUT_OF_ROOM (default: 30) */
  lowThreshold?: number;
}

export class AcousticReceiver {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;
  private dataArray: Uint8Array | null = null;
  private intervalId: number = 0;

  private state: ReceiverState = 'idle';
  private proximity: ProximityState = 'unknown';
  private targetFreq: number;
  private highThreshold: number;
  private lowThreshold: number;
  private fftSize = FFT_SIZE;

  private energyBuffer: number[] = [];
  private noiseFloor: number = 0;
  private calibSamples: number[] = [];

  private highCount = 0;
  private lowCount = 0;

  onStateChange?: (state: ReceiverState) => void;
  onProximityChange?: (state: ProximityState, rawEnergy: number) => void;
  onEnergy?: (raw: number, smoothed: number, noiseFloor: number) => void;

  get currentState() { return this.state; }
  get currentProximity() { return this.proximity; }

  constructor(config?: AcousticReceiverConfig) {
    this.targetFreq = config?.targetFrequency ?? 19500;
    this.highThreshold = config?.highThreshold ?? 80;
    this.lowThreshold = config?.lowThreshold ?? 30;
  }

  private getTargetBin(sampleRate: number): number {
    return Math.round((this.targetFreq * this.fftSize) / sampleRate);
  }

  private getRawEnergy(): number {
    if (!this.dataArray || !this.analyser) return 0;
    // @ts-ignore
    this.analyser.getByteFrequencyData(this.dataArray);
    const ctx = this.ctx!;
    const bin = this.getTargetBin(ctx.sampleRate);
    if (bin >= this.dataArray.length) return 0;
    return this.dataArray[bin];
  }

  async start() {
    if (this.state !== 'idle') return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch {
      this.state = 'error';
      this.onStateChange?.('error');
      return;
    }

    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.src.connect(this.analyser);

    this.state = 'calibrating';
    this.onStateChange?.('calibrating');
    this.calibSamples = [];

    // Calibrate noise floor for 2s
    const calibInterval = setInterval(() => {
      const e = this.getRawEnergy();
      this.calibSamples.push(e);
    }, SAMPLE_INTERVAL);

    await new Promise(resolve => setTimeout(resolve, CALIB_DURATION_MS));
    clearInterval(calibInterval);

    this.calibSamples.sort((a, b) => a - b);
    this.noiseFloor = this.calibSamples[Math.floor(this.calibSamples.length * 0.1)] || 0;

    this.energyBuffer = [];
    this.state = 'listening';
    this.onStateChange?.('listening');
    this.startPolling();
  }

  private startPolling() {
    this.intervalId = window.setInterval(() => {
      const raw = this.getRawEnergy();
      this.energyBuffer.push(raw);
      if (this.energyBuffer.length > MOVING_AVG_WINDOW) this.energyBuffer.shift();
      const smoothed = this.energyBuffer.reduce((a, b) => a + b, 0) / this.energyBuffer.length;

      this.onEnergy?.(raw, smoothed, this.noiseFloor);

      const highMark = this.noiseFloor + this.highThreshold;
      const lowMark = this.noiseFloor + this.lowThreshold;

      if (smoothed > highMark) {
        this.highCount++;
        this.lowCount = 0;
        if (this.highCount >= HYSTERESIS_HIGH_COUNT && this.proximity !== 'in_room') {
          this.proximity = 'in_room';
          this.onProximityChange?.('in_room', raw);
        }
      } else if (smoothed < lowMark) {
        this.lowCount++;
        this.highCount = 0;
        if (this.lowCount >= HYSTERESIS_LOW_COUNT && this.proximity !== 'out_of_room') {
          this.proximity = 'out_of_room';
          this.onProximityChange?.('out_of_room', raw);
        }
      } else {
        this.highCount = 0;
        this.lowCount = 0;
      }
    }, SAMPLE_INTERVAL);
  }

  stop() {
    clearInterval(this.intervalId);
    try { this.src?.disconnect(); } catch {}
    try { this.ctx?.close(); } catch {}
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    this.src = null;
    this.analyser = null;
    this.ctx = null;
    this.stream = null;
    this.dataArray = null;
    this.state = 'idle';
    this.proximity = 'unknown';
    this.energyBuffer = [];
    this.calibSamples = [];
    this.highCount = 0;
    this.lowCount = 0;
    this.onStateChange?.('idle');
  }

  destroy() { this.stop(); }
}
