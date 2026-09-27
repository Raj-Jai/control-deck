import { useEffect, useState, useRef } from 'react';
import { Bluetooth, BluetoothSearching, RadioTower } from 'lucide-react';

const DEVICE_NAME = 'conquest';
const ALPHA = 0.3;
const HIGH = -50;
const LOW = -75;
const HYST = 3;

type Prox = 'unknown' | 'in_room' | 'out_of_room';

function proxColor(s: Prox): string {
  switch (s) {
    case 'in_room': return 'text-green-400';
    case 'out_of_room': return 'text-red-400';
    default: return 'text-deck-dim';
  }
}

export default function BleProximityCard() {
  const [advOn, setAdvOn] = useState(false);
  const [state, setState] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [prox, setProx] = useState<Prox>('unknown');
  const [rssi, setRssi] = useState(0);
  const [smoothed, setSmoothed] = useState(0);
  const [dist, setDist] = useState(0);
  const deviceRef = useRef<BluetoothDevice | null>(null);
  // The listener is held in a ref because stop() has to remove the exact
  // function that was added. Passing a fresh arrow to removeEventListener
  // matches nothing, so the old handler stayed attached forever (BUG-029).
  const advHandlerRef = useRef<((e: Event) => void) | null>(null);
  const smoothedRef = useRef(0);
  const highCnt = useRef(0);
  const lowCnt = useRef(0);

  // Laptop-side BLE advertisement toggle
  const toggleAdv = async () => {
    if (advOn) {
      await fetch('/api/ble/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      setAdvOn(false);
    } else {
      // The name has to be sent: the host sets the adapter alias from it, and
      // the phone's scanner filters on exactly this string. Without it the two
      // halves could never find each other.
      const res = await fetch('/api/ble/transmit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', name: DEVICE_NAME }),
      });
      const data = await res.json();
      if (data.ok) setAdvOn(true);
    }
  };

  // Phone-side scanner
  const start = async () => {
    setState('scanning');
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: DEVICE_NAME }],
      });
      deviceRef.current = device;

      const onAdvertisement = (e: Event) => {
        const evt = e as BluetoothAdvertisingEvent;
        const raw = evt.rssi;
        if (raw === undefined || raw === null) return;

        setRssi(raw);
        const prev = smoothedRef.current;
        const sm = prev === 0 ? raw : ALPHA * raw + (1 - ALPHA) * prev;
        smoothedRef.current = sm;
        setSmoothed(sm);

        const txPower = -59;
        const n = 2.5;
        const d = Math.pow(10, (txPower - sm) / (10 * n));
        setDist(d);

        if (sm > HIGH) { highCnt.current++; lowCnt.current = 0; if (highCnt.current >= HYST) setProx('in_room'); }
        else if (sm < LOW) { lowCnt.current++; highCnt.current = 0; if (lowCnt.current >= HYST) setProx('out_of_room'); }
        else { highCnt.current = 0; lowCnt.current = 0; setProx('unknown'); }
      };
      advHandlerRef.current = onAdvertisement;
      device.addEventListener('advertisementreceived', onAdvertisement);

      await device.watchAdvertisements();
    } catch (err) {
      // Closing the chooser is not an error; the user changed their mind.
      const name = (err as { name?: string })?.name;
      setState(name === 'NotFoundError' ? 'idle' : 'error');
    }
  };

  const stop = () => {
    const device = deviceRef.current;
    if (device) {
      if (advHandlerRef.current) {
        device.removeEventListener('advertisementreceived', advHandlerRef.current);
      }
      advHandlerRef.current = null;
      // unwatchAdvertisements is the only thing that actually ends the scan;
      // dropping the reference left the radio running. It is not in the DOM
      // lib's BluetoothDevice type yet, so it is reached through the same
      // optional-call dance the spec defines.
      const unwatch = (device as unknown as {
        unwatchAdvertisements?: () => Promise<void>;
      }).unwatchAdvertisements;
      if (unwatch) {
        Promise.resolve(unwatch.call(device)).catch(() => {});
      }
      device.gatt?.disconnect?.();
    }
    deviceRef.current = null;
    setState('idle');
    setProx('unknown');
    setRssi(0);
    setSmoothed(0);
    setDist(0);
    smoothedRef.current = 0;
    highCnt.current = 0;
    lowCnt.current = 0;
  };

  useEffect(() => () => {
    stop();
    fetch('/api/ble/transmit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).catch(() => {});
  }, []);

  // With no reading yet, smoothed is 0, which mapped to a full green bar: the
  // card looked like a strong in-room signal before a single packet arrived.
  // Anything from a scan that has not reported is "no signal", not a value.
  const haveReading = state === 'scanning' && smoothed !== 0;
  const rssiPct = haveReading ? Math.min(100, Math.max(0, ((smoothed + 100) / 80) * 100)) : 0;
  const distStr = haveReading && dist > 0 ? dist.toFixed(1) + 'm' : '—';

  return (
    <div className="deck-card flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Bluetooth size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          BLE Proximity
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

      {/* Laptop advertiser */}
      <div className="flex items-center gap-2">
        <RadioTower size={13} className="text-deck-muted/40 flex-shrink-0" />
        <span className="text-[10px] text-deck-dim w-20">Advertiser</span>
        <button
          aria-label={advOn ? 'Stop advertising' : 'Start advertising'}
          aria-pressed={advOn}
          onClick={toggleAdv}
          className={`icon-btn min-h-[44px] px-3 text-[11px] font-medium ${advOn ? 'text-green-400 bg-green-500/15 border-green-500/20' : ''}`}
        >
          {advOn ? 'ON' : 'OFF'}
        </button>
        <span className="text-[10px] text-deck-dim">{advOn ? 'Advertising' : 'Idle'}</span>
        {advOn && <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
      </div>

      {/* Phone scanner */}
      <div className="flex items-center gap-2">
        {state === 'scanning' ? <BluetoothSearching size={13} className="text-yellow-400 animate-pulse" /> : <Bluetooth size={13} className="text-deck-muted/40" />}
        <span className="text-[10px] text-deck-dim w-20">Scanner</span>
        <button
          aria-label={state === 'scanning' ? 'Stop scanning' : 'Start scanning'}
          aria-pressed={state === 'scanning'}
          onClick={state === 'scanning' ? stop : start}
          className={`icon-btn min-h-[44px] px-3 text-[11px] font-medium ${state === 'scanning' ? 'text-cyan-400 bg-cyan-500/15 border-cyan-500/20' : ''}`}
        >
          {state === 'scanning' ? 'STOP' : 'SCAN'}
        </button>
        <span className="text-[10px] text-deck-dim">
          {state === 'idle' ? 'Idle' : state === 'scanning' ? 'Scanning…' : 'Error'}
        </span>
        {state === 'scanning' && <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
      </div>

      {/* RSSI meter */}
      <div className="h-6 rounded bg-white/[0.04] overflow-hidden relative">
        <div
          className="h-full transition-all duration-200 rounded-r"
          style={{
            width: `${rssiPct}%`,
            background: smoothed > HIGH
              ? 'linear-gradient(90deg, #22c55e, #16a34a)'
              : smoothed > LOW
                ? 'linear-gradient(90deg, #eab308, #ca8a04)'
                : 'linear-gradient(90deg, #ef4444, #dc2626)',
          }}
        />
        <div className="absolute inset-0 flex items-center px-2 text-[9px] font-mono text-white/90" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
          {haveReading ? (
            <>
              <span>RSSI: {rssi} dBm</span>
              <span className="ml-2">sm: {smoothed.toFixed(0)} dBm</span>
              <span className="ml-2">dist: {distStr}</span>
            </>
          ) : (
            <span>{state === 'error' ? 'Scan failed' : state === 'scanning' ? 'Waiting for a beacon…' : 'No reading'}</span>
          )}
        </div>
      </div>

      {/* Proximity */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03]">
        <RadioTower size={14} className={proxColor(prox)} />
        <span className={`text-[11px] font-semibold ${proxColor(prox)}`}>
          {prox === 'in_room' && 'IN ROOM'}
          {prox === 'out_of_room' && 'OUT OF ROOM'}
          {prox === 'unknown' && '—'}
        </span>
      </div>
    </div>
  );
}
