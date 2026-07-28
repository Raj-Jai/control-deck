import { useEffect, useState, useRef } from 'react';
import { Waves, Mic, Radio, RadioTower } from 'lucide-react';
import { AcousticTransmitter } from '../lib/AcousticTransmitter';
import { AcousticReceiver, type ProximityState, type ReceiverState } from '../lib/AcousticReceiver';

function proximityColor(s: ProximityState): string {
  switch (s) {
    case 'in_room': return 'text-green-400';
    case 'out_of_room': return 'text-red-400';
    default: return 'text-deck-dim';
  }
}

function receiverLabel(s: ReceiverState): string {
  switch (s) {
    case 'idle': return 'Idle';
    case 'calibrating': return 'Calibrating…';
    case 'listening': return 'Listening';
    case 'error': return 'Error';
  }
}

export default function AcousticProximityCard() {
  const txRef = useRef<AcousticTransmitter | null>(null);
  const rxRef = useRef<AcousticReceiver | null>(null);

  const [txOn, setTxOn] = useState(false);
  const [freq, setFreq] = useState(19500);
  const [rxState, setRxState] = useState<ReceiverState>('idle');
  const [prox, setProx] = useState<ProximityState>('unknown');
  const [energy, setEnergy] = useState(0);
  const [smoothed, setSmoothed] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);

  useEffect(() => {
    const tx = new AcousticTransmitter();
    const rx = new AcousticReceiver({
      targetFrequency: freq,
      highThreshold: 80,
      lowThreshold: 30,
    });

    tx.onStateChange = (s) => setTxOn(s === 'playing');
    rx.onStateChange = (s) => setRxState(s);
    rx.onProximityChange = (s) => setProx(s);
    rx.onEnergy = (raw, sm, nf) => { setEnergy(raw); setSmoothed(sm); setNoiseFloor(nf); };

    txRef.current = tx;
    rxRef.current = rx;

    return () => { tx.destroy(); rx.destroy(); };
  }, []);

  useEffect(() => { txRef.current?.setFrequency(freq); }, [freq]);

  const toggleTx = () => {
    const tx = txRef.current;
    if (!tx) return;
    tx.playing ? tx.stop() : tx.start();
  };

  const toggleRx = async () => {
    const rx = rxRef.current;
    if (!rx) return;
    if (rx.currentState === 'idle' || rx.currentState === 'error') await rx.start();
    else rx.stop();
  };

  const maxBar = Math.max(255, noiseFloor + 120);
  const energyPct = Math.min(100, (smoothed / maxBar) * 100);

  return (
    <div className="deck-card flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Waves size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Acoustic Proximity
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

      {/* Transmitter */}
      <div className="flex items-center gap-2">
        <Radio size={13} className="text-deck-muted/40 flex-shrink-0" />
        <span className="text-[10px] text-deck-dim w-20">Transmitter</span>
        <button
          onPointerDown={toggleTx}
          className={`icon-btn h-7 px-2.5 text-[10px] font-medium ${txOn ? 'text-green-400 bg-green-500/15 border-green-500/20' : ''}`}
        >
          {txOn ? 'ON' : 'OFF'}
        </button>
        <input
          type="range" min={18500} max={20000} step={100}
          value={freq}
          onChange={e => setFreq(Number(e.target.value))}
          className="flex-1 h-1 accent-deck-accent"
        />
        <span className="text-[10px] text-deck-dim w-14 text-right font-mono">{(freq / 1000).toFixed(1)}kHz</span>
      </div>

      {/* Receiver */}
      <div className="flex items-center gap-2">
        <Mic size={13} className="text-deck-muted/40 flex-shrink-0" />
        <span className="text-[10px] text-deck-dim w-20">Receiver</span>
        <button
          onPointerDown={toggleRx}
          className={`icon-btn h-7 px-2.5 text-[10px] font-medium ${rxState === 'listening' ? 'text-cyan-400 bg-cyan-500/15 border-cyan-500/20' : ''}`}
        >
          {rxState === 'idle' || rxState === 'error' ? 'START' : 'STOP'}
        </button>
        <span className="text-[10px] text-deck-dim">{receiverLabel(rxState)}</span>
        {rxState === 'calibrating' && <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />}
      </div>

      {/* Energy meter */}
      <div className="h-6 rounded bg-white/[0.04] overflow-hidden relative">
        <div
          className="h-full transition-all duration-100 rounded-r"
          style={{
            width: `${energyPct}%`,
            background: smoothed > noiseFloor + 80
              ? 'linear-gradient(90deg, #22c55e, #16a34a)'
              : smoothed > noiseFloor + 30
                ? 'linear-gradient(90deg, #eab308, #ca8a04)'
                : 'linear-gradient(90deg, #ef4444, #dc2626)',
          }}
        />
        <div className="absolute inset-0 flex items-center px-2 text-[9px] font-mono text-deck-dim">
          <span>sig: {energy}</span>
          <span className="ml-2">sm: {smoothed.toFixed(0)}</span>
          <span className="ml-2">floor: {noiseFloor}</span>
        </div>
      </div>

      {/* Proximity status */}
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/[0.03]">
        <RadioTower size={14} className={proximityColor(prox)} />
        <span className={`text-[11px] font-semibold ${proximityColor(prox)}`}>
          {prox === 'in_room' && 'IN ROOM'}
          {prox === 'out_of_room' && 'OUT OF ROOM'}
          {prox === 'unknown' && '—'}
        </span>
        <span className="text-[9px] text-deck-muted/40 ml-auto">
          FFT bin: {rxRef.current ? Math.round((freq * 2048) / 48000) : '—'} / {1024}
        </span>
      </div>
    </div>
  );
}
