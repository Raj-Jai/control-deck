const SERVICE_UUID = '12345678-1234-5678-1234-567812345678';

export type BleProximityState = 'unknown' | 'in_room' | 'out_of_room';
export type BleReceiverState = 'idle' | 'scanning' | 'connected' | 'error';

const ALPHA = 0.3;
const HIGH_THRESHOLD = -65;
const LOW_THRESHOLD = -82;
const HYSTERESIS_N = 3;
const POLL_MS = 2000;

export class BleRssiMonitor {
  private device: BluetoothDevice | null = null;
  private gattServer: BluetoothRemoteGATTServer | null = null;
  private service: BluetoothRemoteGATTService | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  state: BleReceiverState = 'idle';
  proximity: BleProximityState = 'unknown';
  rssi = 0;
  smoothed = 0;
  distance = 0;

  private highCount = 0;
  private lowCount = 0;

  onStateChange: ((s: BleReceiverState) => void) | null = null;
  onProximityChange: ((s: BleProximityState) => void) | null = null;
  onRssi: ((raw: number, smoothed: number, distance: number) => void) | null = null;

  get currentState() { return this.state; }
  get currentProximity() { return this.proximity; }

  async start() {
    if (this.state === 'scanning' || this.state === 'connected') return;
    this.setState('scanning');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }],
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.cleanup();
        this.setState('idle');
      });

      this.gattServer = await this.device.gatt!.connect();
      this.service = await this.gattServer.getPrimaryService(SERVICE_UUID);
      this.setState('connected');

      this.startPolling();
    } catch (err) {
      this.setState('error');
    }
  }

  stop() {
    this.cleanup();
    this.setState('idle');
  }

  destroy() { this.stop(); }

  private startPolling() {
    this.intervalId = setInterval(() => this.poll(), POLL_MS);
  }

  private async poll() {
    if (!this.service) return;

    try {
      const rssiChar = await this.service.getCharacteristic('00002a19-0000-1000-8000-00805f9b34fb');
      const value = await rssiChar.readValue();
      const raw = value.getInt8(0);

      this.rssi = raw;
      if (this.smoothed === 0) {
        this.smoothed = raw;
      } else {
        this.smoothed = ALPHA * raw + (1 - ALPHA) * this.smoothed;
      }

      const txPower = -59;
      const n = 2.5;
      this.distance = Math.pow(10, (txPower - this.smoothed) / (10 * n));

      if (this.smoothed > HIGH_THRESHOLD) {
        this.highCount++;
        this.lowCount = 0;
        if (this.highCount >= HYSTERESIS_N) this.setProximity('in_room');
      } else if (this.smoothed < LOW_THRESHOLD) {
        this.lowCount++;
        this.highCount = 0;
        if (this.lowCount >= HYSTERESIS_N) this.setProximity('out_of_room');
      } else {
        this.highCount = 0;
        this.lowCount = 0;
        this.setProximity('unknown');
      }

      this.onRssi?.(raw, this.smoothed, this.distance);
    } catch {
      this.setState('error');
    }
  }

  private setState(s: BleReceiverState) {
    this.state = s;
    this.onStateChange?.(s);
  }

  private setProximity(p: BleProximityState) {
    if (this.proximity !== p) {
      this.proximity = p;
      this.onProximityChange?.(p);
    }
  }

  private cleanup() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.service = null;
    if (this.gattServer?.connected) this.gattServer.disconnect();
    this.gattServer = null;
    this.device = null;
    this.smoothed = 0;
    this.highCount = 0;
    this.lowCount = 0;
  }
}
