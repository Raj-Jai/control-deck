import { useRef, useState, useEffect } from 'react';
import { Moon, Volume2, VolumeX } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand, setVolume, setBrightness } from '../services/apiService';

interface StepperControlsProps {
  state: MediaState | null;
}

const THROTTLE_MS = 80;

export default function StepperControls({ state }: StepperControlsProps) {
  const draggingVol = useRef(false);
  const draggingBri = useRef(false);
  const lastVolSend = useRef(0);
  const lastBriSend = useRef(0);
  const [localVol, setLocalVol] = useState(100);
  const [localBri, setLocalBri] = useState(100);

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;

  // Sync display from SSE when not dragging
  useEffect(() => {
    if (!draggingVol.current && !draggingBri.current) return;
  });

  const showVol = draggingVol.current
    ? localVol
    : (vol >= 0 ? Math.round(vol * 100) : localVol);
  const showBri = draggingBri.current
    ? localBri
    : (bri >= 0 ? Math.round(bri) : localBri);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* Volume */}
      <div className="deck-card">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim mb-2">
          Volume
        </div>
        <div className="flex items-center gap-2.5">
          <button
            className={`icon-btn w-9 h-9 text-base flex-shrink-0 ${
              muted ? 'bg-red-500/15 border-red-500/20 text-red-400' : 'text-deck-text'
            }`}
            onClick={() => triggerCommand('mute')}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={showVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLocalVol(v);
              draggingVol.current = true;
              const now = Date.now();
              if (now - lastVolSend.current >= THROTTLE_MS) {
                lastVolSend.current = now;
                setVolume(v / 100);
              }
            }}
            onMouseUp={() => {
              draggingVol.current = false;
              setVolume(localVol / 100);
            }}
            onTouchEnd={() => {
              draggingVol.current = false;
              setVolume(localVol / 100);
            }}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {showVol}%
          </span>
        </div>
      </div>

      {/* Brightness */}
      <div className="deck-card">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim mb-2">
          Brightness
        </div>
        <div className="flex items-center gap-2.5">
          <button
            className={`icon-btn w-9 h-9 text-base flex-shrink-0 ${
              nightOn
                ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                : 'text-deck-text'
            }`}
            onClick={() => triggerCommand(nightOn ? 'nightOff' : 'nightOn')}
          >
            <Moon size={16} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={showBri}
            onChange={(e) => {
              const v = Number(e.target.value);
              setLocalBri(v);
              draggingBri.current = true;
              const now = Date.now();
              if (now - lastBriSend.current >= THROTTLE_MS) {
                lastBriSend.current = now;
                setBrightness(v);
              }
            }}
            onMouseUp={() => {
              draggingBri.current = false;
              setBrightness(localBri);
            }}
            onTouchEnd={() => {
              draggingBri.current = false;
              setBrightness(localBri);
            }}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {showBri}%
          </span>
        </div>
      </div>
    </div>
  );
}
