import { useRef, useState, useCallback } from 'react';
import { Moon, Volume2, VolumeX } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand, setVolume, setBrightness } from '../services/apiService';

interface StepperControlsProps {
  state: MediaState | null;
}

export default function StepperControls({ state }: StepperControlsProps) {
  const isDraggingVol = useRef(false);
  const isDraggingBri = useRef(false);
  const [localVol, setLocalVol] = useState(100);
  const [localBri, setLocalBri] = useState(100);

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;

  const displayVol = vol >= 0 && !isDraggingVol.current ? Math.round(vol * 100) : localVol;
  const displayBri = bri >= 0 && !isDraggingBri.current ? Math.round(bri) : localBri;

  const handleVolChange = useCallback((value: number) => {
    isDraggingVol.current = true;
    setLocalVol(value);
  }, []);

  const handleVolCommit = useCallback((value: number) => {
    isDraggingVol.current = false;
    setVolume(value / 100);
  }, []);

  const handleBriChange = useCallback((value: number) => {
    isDraggingBri.current = true;
    setLocalBri(value);
  }, []);

  const handleBriCommit = useCallback((value: number) => {
    isDraggingBri.current = false;
    setBrightness(value);
  }, []);

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
            value={displayVol}
            onChange={(e) => handleVolChange(Number(e.target.value))}
            onMouseUp={() => handleVolCommit(displayVol)}
            onTouchEnd={() => handleVolCommit(displayVol)}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {displayVol}%
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
            value={displayBri}
            onChange={(e) => handleBriChange(Number(e.target.value))}
            onMouseUp={() => handleBriCommit(displayBri)}
            onTouchEnd={() => handleBriCommit(displayBri)}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {displayBri}%
          </span>
        </div>
      </div>
    </div>
  );
}
