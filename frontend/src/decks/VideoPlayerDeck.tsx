import { useState, useEffect, useRef } from 'react';
import PlayerCarousel from '../components/PlayerCarousel';
import { fetchVideoStatus, sendVideoCommand } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

const aspects = ['Default', '16:9', '4:3', '21:9', '3:2', 'Crop Fill'];
const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];

function fmt(v: number): string {
  if (v === 0) return '0s';
  return (v > 0 ? '+' : '') + v.toFixed(1) + 's';
}

export default function VideoPlayerDeck({ state, caps }: Props) {
  const [vs, setVS] = useState<Awaited<ReturnType<typeof fetchVideoStatus>> | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [audioDelay, setAudioDelay] = useState(0);
  const subRef = useRef(0);
  const audioRef = useRef(0);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await fetchVideoStatus();
        if (dead) return;
        setVS(v);
        setSubDelay(v.sub_delay);
        setAudioDelay(v.audio_delay);
        subRef.current = v.sub_delay;
        audioRef.current = v.audio_delay;
      } catch { /* ignore */ }
      if (!dead) timer = setTimeout(poll, 1000);
    };
    poll();
    return () => { dead = true; clearTimeout(timer); };
  }, []);

  const nudge = (kind: 'sub' | 'audio', delta: number) => {
    const action = kind === 'sub' ? 'set_sub_delay' : 'set_audio_delay';
    const ref = kind === 'sub' ? subRef : audioRef;
    const next = Math.round((ref.current + delta) * 10) / 10;
    ref.current = next;
    if (kind === 'sub') setSubDelay(next);
    else setAudioDelay(next);
    sendVideoCommand(action, { value: next });
  };

  const resetDelay = (kind: 'sub' | 'audio') => {
    const action = kind === 'sub' ? 'set_sub_delay' : 'set_audio_delay';
    const ref = kind === 'sub' ? subRef : audioRef;
    ref.current = 0;
    if (kind === 'sub') setSubDelay(0);
    else setAudioDelay(0);
    sendVideoCommand(action, { value: 0 });
  };

  const player = vs?.active_player ?? 'unknown';

  return (
    <div className="flex flex-col gap-4">
      {caps.playerctl && (
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
          <PlayerCarousel players={state?.players ?? []} state={state} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-deck-muted/50 uppercase tracking-wider">Player:</span>
        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${
          player === 'mpv' ? 'bg-blue-500/20 text-blue-300' :
          player === 'vlc' ? 'bg-orange-500/20 text-orange-300' :
          'bg-white/5 text-deck-dim'
        }`}>
          {player === 'unknown' ? 'Not detected' : player}
        </span>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Subtitles</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => sendVideoCommand('set_subtitle', { track_id: 0 })}
            className="px-3 py-1.5 text-[11px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
            Toggle
          </button>
          <span className="text-[10px] text-deck-dim/50">(v key)</span>
          <div className="flex-1" />
          <button onClick={() => nudge('sub', -0.1)}
            className="w-8 h-8 rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">−</button>
          <span className="text-[11px] font-mono text-deck-accent min-w-[4ch] text-center tabular-nums">{fmt(subDelay)}</span>
          <button onClick={() => nudge('sub', 0.1)}
            className="w-8 h-8 rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">+</button>
          <button onClick={() => resetDelay('sub')}
            className="px-2 py-1 text-[10px] rounded bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90">Reset</button>
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Audio</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => sendVideoCommand('set_audio', { track_id: 1 })}
            className="px-3 py-1.5 text-[11px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
            Cycle
          </button>
          <span className="text-[10px] text-deck-dim/50">(b key)</span>
          <div className="flex-1" />
          <button onClick={() => nudge('audio', -0.1)}
            className="w-8 h-8 rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">−</button>
          <span className="text-[11px] font-mono text-deck-accent min-w-[4ch] text-center tabular-nums">{fmt(audioDelay)}</span>
          <button onClick={() => nudge('audio', 0.1)}
            className="w-8 h-8 rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">+</button>
          <button onClick={() => resetDelay('audio')}
            className="px-2 py-1 text-[10px] rounded bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent active:scale-90">Reset</button>
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Aspect Ratio</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {aspects.map(a => {
            const active = vs?.aspect_ratio != null && a.toLowerCase() === vs.aspect_ratio.toLowerCase();
            return (
              <button key={a} onClick={() => sendVideoCommand('set_aspect', { value: a })}
                className={`px-2.5 py-1 text-[11px] rounded-md border transition-all active:scale-90 ${
                  active
                    ? 'bg-deck-accent/20 border-deck-accent/40 text-deck-accent'
                    : 'bg-white/5 border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
                }`}>
                {a}
              </button>
            );
          })}
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Precision Playback</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => sendVideoCommand('frame_step', { direction: 'prev' })}
            className="flex-1 px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90
              flex items-center justify-center gap-1.5">
            ◀ Frame Prev
          </button>
          <button onClick={() => sendVideoCommand('frame_step', { direction: 'next' })}
            className="flex-1 px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90
              flex items-center justify-center gap-1.5">
            Frame Next ▶
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-deck-muted/50 uppercase tracking-wider mr-1">Speed</span>
          <div className="flex flex-wrap gap-1.5">
            {speeds.map(s => {
              const active = vs?.speed != null && Math.abs(vs.speed - s) < 0.01;
              return (
                <button key={s} onClick={() => sendVideoCommand('set_speed', { value: s })}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-all active:scale-90 ${
                    active
                      ? 'bg-deck-accent/20 border-deck-accent/40 text-deck-accent'
                      : 'bg-white/5 border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
                  }`}>
                  {s}x
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
