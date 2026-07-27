import { useRef, useState, useEffect } from 'react';
import { Volume2, VolumeX, Moon, Speaker, Headphones, Music } from 'lucide-react';
import type { MediaState, AppStreamInfo } from '../hooks/useMediaStream';
import { triggerCommand, setVolume, setBrightness, setDefaultSink, sliderToValue, valueToSlider } from '../services/apiService';

interface MixerCardProps {
  state: MediaState | null;
  caps: Record<string, boolean>;
}

const THROTTLE = 80;

export default function MixerCard({ state, caps }: MixerCardProps) {
  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;
  const sinks = state?.sinks ?? [];

  const [localVol, setLocalVol] = useState(100);
  const [localBri, setLocalBri] = useState(100);
  const draggingVol = useRef(false);
  const draggingBri = useRef(false);
  const lastVolSend = useRef(0);
  const lastBriSend = useRef(0);

  const showVol = draggingVol.current ? localVol : (vol >= 0 ? Math.round(valueToSlider(vol, 1) * 100) : localVol);
  const showBri = draggingBri.current ? localBri : (bri >= 0 ? Math.round(valueToSlider(bri, 100)) : localBri);

  const isBT = (s: AppStreamInfo & { id: number; name?: string; description?: string; default?: boolean }) =>
    /bluez/i.test((s as any).name ?? '');
  const btSink = sinks.find(isBT as any);
  const speakerSink = sinks.find(s => !isBT(s as any) && !/hdmi/i.test((s as any).description ?? ''));
  const activeSink = sinks.find(s => (s as any).default);
  const hasSinks = !!(btSink && speakerSink && activeSink);
  const activeIsBT = hasSinks && activeSink!.id === btSink!.id;

  const toggleSink = () => {
    if (!hasSinks) return;
    const target = activeIsBT ? speakerSink! : btSink!;
    setDefaultSink(target.id);
  };

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          Mixer
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

      <div className="flex flex-col gap-4">
        {/* Volume row */}
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-deck-muted/50 mb-1.5">
            Volume
          </div>
          <div className="flex items-center gap-2.5">
            <button
              className={`icon-btn w-9 h-9 flex-shrink-0 ${muted ? 'bg-red-500/15 border-red-500/20 text-red-400' : ''}`}
              onClick={() => triggerCommand('mute')}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range" min={0} max={100} value={showVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setLocalVol(v);
                draggingVol.current = true;
                const now = Date.now();
                  if (now - lastVolSend.current >= THROTTLE) {
                    lastVolSend.current = now;
                    setVolume(sliderToValue(v / 100, 1));
                  }
                }}
                onMouseUp={() => { draggingVol.current = false; setVolume(sliderToValue(localVol / 100, 1)); }}
                onTouchEnd={() => { draggingVol.current = false; setVolume(sliderToValue(localVol / 100, 1)); }}
              className="flex-1"
            />
            <span className="text-sm font-bold w-[36px] text-right text-deck-text">{showVol}%</span>
            {hasSinks && (
              <button onClick={toggleSink} className="icon-btn w-9 h-9 flex-shrink-0">
                {activeIsBT ? <Speaker size={16} /> : <Headphones size={16} />}
              </button>
            )}
          </div>
        </div>

        {/* Brightness row */}
        {caps.brightness && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-deck-muted/50 mb-1.5">
              Brightness
            </div>
            <div className="flex items-center gap-2.5">
              <button
                className={`icon-btn w-9 h-9 flex-shrink-0 ${nightOn ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent' : ''}`}
                onClick={() => triggerCommand(nightOn ? 'nightOff' : 'nightOn')}
              >
                <Moon size={16} />
              </button>
              <input
                type="range" min={0} max={100} value={showBri}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLocalBri(v);
                  draggingBri.current = true;
                  const now = Date.now();
                  if (now - lastBriSend.current >= THROTTLE) {
                    lastBriSend.current = now;
                    setBrightness(sliderToValue(v, 100));
                  }
                }}
                onMouseUp={() => { draggingBri.current = false; setBrightness(sliderToValue(localBri, 100)); }}
                onTouchEnd={() => { draggingBri.current = false; setBrightness(sliderToValue(localBri, 100)); }}
                className="flex-1"
              />
              <span className="text-sm font-bold w-[36px] text-right text-deck-text">{showBri}%</span>
            </div>
          </div>
        )}

        {/* App audio streams */}
        {state?.app_streams && state.app_streams.length > 0 && (
          <AppStreamsList streams={state.app_streams} />
        )}
      </div>
    </div>
  );
}

function AppStreamsList({ streams }: { streams: AppStreamInfo[] }) {
  const [localVol, setLocalVol] = useState<Record<number, number>>({});
  const dragging = useRef<Record<number, boolean>>({});
  const lastSend = useRef<Record<number, number>>({});

  const setStream = async (id: number, body: Record<string, unknown>) => {
    try {
      await fetch('/api/audio/set-app-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
    } catch {}
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Music size={14} className="text-deck-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-deck-muted/50">
          App Audio
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {streams.map((s) => {
          const vol = dragging.current[s.id] ? (localVol[s.id] ?? s.volume) : s.volume;
          return (
            <div key={s.id} className="flex items-center gap-2 py-1 px-2 rounded-lg bg-white/[0.03]">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium truncate">{s.app || 'Unknown'}</div>
                <div className="text-[10px] text-deck-dim truncate">
                  {s.media_name && s.media_name !== s.app ? s.media_name : `#${s.id}`}
                </div>
              </div>
              <button
                className={`icon-btn w-8 h-8 flex-shrink-0 ${s.muted ? 'bg-red-500/15 border-red-500/20 text-red-400' : ''}`}
                onClick={() => setStream(s.id, { muted: !s.muted })}
              >
                {s.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
              <input
                type="range" min={0} max={100} value={vol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLocalVol(p => ({ ...p, [s.id]: v }));
                  dragging.current[s.id] = true;
                  const now = Date.now();
                  if (now - (lastSend.current[s.id] ?? 0) >= THROTTLE) {
                    lastSend.current[s.id] = now;
                    setStream(s.id, { volume: v });
                  }
                }}
                onMouseUp={() => { dragging.current[s.id] = false; setStream(s.id, { volume: localVol[s.id] ?? s.volume }); }}
                onTouchEnd={() => { dragging.current[s.id] = false; setStream(s.id, { volume: localVol[s.id] ?? s.volume }); }}
                className="flex-1 min-w-0"
              />
              <span className="text-[11px] font-bold w-[28px] text-right text-deck-text flex-shrink-0">{vol}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
