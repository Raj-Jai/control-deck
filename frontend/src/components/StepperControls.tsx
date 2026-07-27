import { useRef, useState, useEffect } from 'react';
import { Moon, Volume2, VolumeX, Speaker, Headphones } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capability } from '../hooks/useCapabilities';
import { triggerCommand, setVolume, setBrightness, setDefaultSink, sliderToValue, valueToSlider } from '../services/apiService';
import type { SinkInfo } from '../hooks/useMediaStream';

interface StepperControlsProps {
  state: MediaState | null;
  caps: Record<string, boolean>;
}

const THROTTLE_MS = 80;

export default function StepperControls({ state, caps }: StepperControlsProps) {
  const draggingVol = useRef(false);
  const draggingBri = useRef(false);
  const lastVolSend = useRef(0);
  const lastBriSend = useRef(0);
  const [localVol, setLocalVol] = useState(100);
  const [localBri, setLocalBri] = useState(100);
  const [sinks, setSinks] = useState<SinkInfo[]>([]);
  const [sinkLoading, setSinkLoading] = useState(false);

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;

  // Sync display from SSE when not dragging
  useEffect(() => {
    if (!draggingVol.current && !draggingBri.current) return;
  });

  useEffect(() => {
    if (state?.sinks) setSinks(state.sinks);
  }, [state?.sinks]);

  const handleSinkSelect = async (id: number) => {
    setSinkLoading(true);
    try {
      await setDefaultSink(id);
    } catch {}
    setSinkLoading(false);
  };

  const isBT = (s: SinkInfo) => /bluez/i.test(s.name);
  const btSink = sinks.find(isBT);
  const speakerSink = sinks.find(s => !isBT(s) && !/hdmi/i.test(s.description));
  const activeSink = sinks.find(s => s.default);
  const hasSinks = !!(btSink && speakerSink && activeSink);
  const activeIsBT = hasSinks && activeSink!.id === btSink!.id;

  const toggleSink = () => {
    if (!hasSinks) return;
    const target = activeIsBT ? speakerSink! : btSink!;
    handleSinkSelect(target.id);
  };

  const showVol = draggingVol.current
    ? localVol
    : (vol >= 0 ? Math.round(valueToSlider(vol, 1) * 100) : localVol);
  const showBri = draggingBri.current
    ? localBri
    : (bri >= 0 ? Math.round(valueToSlider(bri, 100)) : localBri);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
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
                setVolume(sliderToValue(v / 100, 1));
              }
            }}
            onMouseUp={() => {
              draggingVol.current = false;
              setVolume(sliderToValue(localVol / 100, 1));
            }}
            onTouchEnd={() => {
              draggingVol.current = false;
              setVolume(sliderToValue(localVol / 100, 1));
            }}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {showVol}%
          </span>
          {hasSinks && (
            <button
              onClick={toggleSink}
              disabled={sinkLoading}
              className="icon-btn w-9 h-9 text-base flex-shrink-0"
            >
              {activeIsBT ? <Speaker size={16} /> : <Headphones size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Brightness */}
      {caps.brightness && <div className="deck-card">
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
                setBrightness(sliderToValue(v, 100));
              }
            }}
            onMouseUp={() => {
              draggingBri.current = false;
              setBrightness(sliderToValue(localBri, 100));
            }}
            onTouchEnd={() => {
              draggingBri.current = false;
              setBrightness(sliderToValue(localBri, 100));
            }}
            className="flex-1"
          />
          <span className="text-sm font-bold min-w-[36px] text-right text-deck-text">
            {showBri}%
          </span>
        </div>
      </div>}


    </div>
  );
}
