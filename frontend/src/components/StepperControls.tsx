import { useRef, useState, useEffect } from 'react';
import { Moon, Volume2, VolumeX } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand, setVolume, setBrightness } from '../services/apiService';

interface StepperControlsProps {
  state: MediaState | null;
}

export default function StepperControls({ state }: StepperControlsProps) {
  const isDraggingVol = useRef(false);
  const isDraggingBri = useRef(false);
  const pendingVol = useRef(false);
  const pendingBri = useRef(false);
  const [localVol, setLocalVol] = useState(100);
  const [localBri, setLocalBri] = useState(100);

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;

  // When SSE confirms pending volume/brightness, release drag state
  useEffect(() => {
    if (pendingVol.current && vol >= 0) {
      if (Math.abs(Math.round(vol * 100) - localVol) <= 2) {
        pendingVol.current = false;
        isDraggingVol.current = false;
      }
    }
    if (pendingBri.current && bri >= 0) {
      if (Math.abs(Math.round(bri) - localBri) <= 2) {
        pendingBri.current = false;
        isDraggingBri.current = false;
      }
    }
  });

  const showVol = pendingVol.current || isDraggingVol.current ? localVol : (vol >= 0 ? Math.round(vol * 100) : localVol);
  const showBri = pendingBri.current || isDraggingBri.current ? localBri : (bri >= 0 ? Math.round(bri) : localBri);

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
              isDraggingVol.current = true;
              setLocalVol(Number(e.target.value));
            }}
            onMouseUp={() => {
              if (isDraggingVol.current) {
                isDraggingVol.current = false;
                pendingVol.current = true;
                setVolume(localVol / 100);
              }
            }}
            onTouchEnd={() => {
              if (isDraggingVol.current) {
                isDraggingVol.current = false;
                pendingVol.current = true;
                setVolume(localVol / 100);
              }
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
              isDraggingBri.current = true;
              setLocalBri(Number(e.target.value));
            }}
            onMouseUp={() => {
              if (isDraggingBri.current) {
                isDraggingBri.current = false;
                pendingBri.current = true;
                setBrightness(localBri);
              }
            }}
            onTouchEnd={() => {
              if (isDraggingBri.current) {
                isDraggingBri.current = false;
                pendingBri.current = true;
                setBrightness(localBri);
              }
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
