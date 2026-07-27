import { useRef } from 'react';
import { Monitor, Captions, VolumeX, Volume2, Play, ChevronUp, ChevronDown, Tv } from 'lucide-react';
import { triggerCommand, setVolume, sliderToValue, valueToSlider } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

function YouTubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6a3 3 0 0 0-2.1 2.1C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.5 15.5V8.5l6.3 3.5-6.3 3.5z" />
    </svg>
  );
}

export default function MediaBrowserDeck({ state, caps }: Props) {
  const activePlayer = state?.players?.find(p => p.status === 'Playing') || state?.players?.[0];
  const playerId = activePlayer?.id;
  const draggingVol = useRef(false);
  const lastVolSend = useRef(0);
  const localVol = useRef(75);

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const showVol = draggingVol.current ? localVol.current : (vol >= 0 ? Math.round(valueToSlider(vol, 1) * 100) : localVol.current);

  return (
    <div className="flex flex-col gap-4">
      {/* Volume Slider */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted">Volume</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="deck-card p-3 flex items-center gap-3">
          <button
            onClick={() => triggerCommand('mute')}
            className={`icon-btn w-8 h-8 flex items-center justify-center flex-shrink-0 ${
              muted ? 'bg-red-500/15 border-red-500/20 text-red-400' : 'text-deck-dim'
            }`}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input
            type="range" min={0} max={100} value={showVol}
            onChange={(e) => {
              const v = Number(e.target.value);
              localVol.current = v;
              draggingVol.current = true;
              const now = Date.now();
              if (now - lastVolSend.current >= 80) {
                lastVolSend.current = now;
                setVolume(sliderToValue(v / 100, 1));
              }
            }}
            onMouseUp={() => {
              draggingVol.current = false;
              setVolume(sliderToValue(localVol.current / 100, 1));
            }}
            onTouchEnd={() => {
              draggingVol.current = false;
              setVolume(sliderToValue(localVol.current / 100, 1));
            }}
            className="w-full"
          />
          <span className="text-[11px] text-deck-dim w-8 text-right tabular-nums">{showVol}%</span>
        </div>
      </div>

      {/* CARD 3: Macro Deck */}
      <div className="deck-card p-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted">Macro Deck</span>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 bg-red-500/15 text-red-400">
            <YouTubeIcon size={12} /> MEDIA
          </span>
        </div>

        {/* Speed Up / Down */}
        <div className="flex gap-2 mb-3">
          <button onClick={() => triggerCommand('speed_down', playerId)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] rounded-md
              bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-95">
            <ChevronDown size={14} /> Slower
          </button>
          <button onClick={() => triggerCommand('speed_up', playerId)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] rounded-md
              bg-deck-accent/15 border border-deck-accent/25 text-deck-accent hover:bg-deck-accent/25 active:scale-95">
            <ChevronUp size={14} /> Faster
          </button>
        </div>

        {/* Macro Touch Grid */}
        <div className="grid grid-cols-4 gap-2">
          <MacroButton label="−5s" sub="←" cmd="key_left" playerId={playerId} />
          <MacroButton label="▶‖ Play/Pause" sub="K" cmd="key_k" playerId={playerId} highlight className="col-span-2" />
          <MacroButton label="+5s" sub="→" cmd="key_right" playerId={playerId} />

          <MacroButton label="Captions" icon={<Captions size={14} />} sub="C" cmd="captions" playerId={playerId} />
          <MacroButton label="Theater" icon={<Tv size={14} />} sub="T" cmd="key_t" playerId={playerId} />
          <MacroButton label="Fullscreen" icon={<Monitor size={14} />} sub="F" cmd="fullscreen" playerId={playerId} />
          <MacroButton label="Mute" icon={<VolumeX size={14} />} sub="M" cmd="key_m" playerId={playerId} />
        </div>
      </div>

      {/* Fallback when playerctl unavailable */}
      {state && !caps.playerctl && (
        <div className="deck-card p-3 flex items-center gap-3">
          <Play size={20} className="text-deck-dim" />
          <span className="text-xs text-deck-dim">No media player detected</span>
        </div>
      )}
    </div>
  );
}

function MacroButton({ label, icon, sub, cmd, playerId, highlight, className }: {
  label: string;
  icon?: React.ReactNode;
  sub?: string;
  cmd: string;
  playerId?: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <button onClick={() => triggerCommand(cmd, playerId)}
      className={`flex flex-col items-center justify-center gap-0.5 py-3 px-2 rounded-lg ${className ?? ''}
        border text-[11px] font-semibold transition-all duration-100 active:scale-90 min-h-[52px]
        ${highlight
          ? 'bg-deck-accent/15 border-deck-accent/25 text-deck-accent'
          : 'bg-white/5 border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
        }`}>
      {icon && <span>{icon}</span>}
      <span>{label}</span>
      {sub && <span className="text-[9px] font-mono opacity-40">{sub}</span>}
    </button>
  );
}
