import { useState, useRef, useEffect } from 'react';
import { Radio, RadioTower, Loader2 } from 'lucide-react';
import { getAudioStreamStatus } from '../services/apiService';

type StreamState = 'idle' | 'loading' | 'playing' | 'error' | 'active_elsewhere';

export default function AudioStreamCard() {
  const [state, setState] = useState<StreamState>('idle');
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const aliveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    const poll = async () => {
      try {
        const active = await getAudioStreamStatus();
        setState(prev => {
          if (active && prev === 'idle') return 'active_elsewhere';
          if (!active && prev === 'active_elsewhere') return 'idle';
          return prev;
        });
      } catch {}
    };
    const iv = setInterval(poll, 3000);
    poll();
    return () => { clearInterval(iv); clearTimeout(retryTimer.current); };
  }, []);

  const cleanup = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current = null;
    }
  };

  const handleToggle = async () => {
    if (state === 'playing') {
      setState('idle');
      cleanup();
      return;
    }

    setState('loading');
    cleanup();

    const audio = new Audio();
    audioRef.current = audio;
    audio.src = '/api/audio-stream/stream';
    audio.preload = 'auto';

    audio.onerror = () => {
      if (!aliveRef.current) return;
      setState('error');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setState('idle'); }, 3000);
    };

    audio.onended = () => {
      if (!aliveRef.current) return;
      setState('idle');
      cleanup();
    };

    try {
      await audio.play();
      if (aliveRef.current) setState('playing');
    } catch (err) {
      if (!aliveRef.current) return;
      setState('error');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setState('idle'); }, 3000);
    }
  };

  const busy = state === 'loading';
  const Icon = state === 'playing' ? RadioTower : Radio;
  const label =
    state === 'idle' ? 'Stream Audio' :
    state === 'loading' ? 'Connecting…' :
    state === 'playing' ? 'Stop Stream' :
    state === 'active_elsewhere' ? 'Join Stream' :
    'Retry…';

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2 mb-2">
        <Radio size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Audio Stream
        </span>
      </div>
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-semibold
          uppercase tracking-wider border transition-all duration-100 active:scale-95
          ${state === 'playing'
            ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/20'
            : 'bg-deck-surface2 border-white/5 text-deck-text hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent'
          }
          disabled:opacity-50 disabled:pointer-events-none`}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <span className={state === 'playing' ? 'animate-pulse' : ''}>
            <Icon size={16} />
          </span>
        )}
        {label}
      </button>
      {state === 'playing' && (
        <div className="text-[10px] text-deck-dim text-center mt-2">
          Streaming MP3 — ~2s latency
        </div>
      )}
      {state === 'active_elsewhere' && (
        <div className="text-[10px] text-deck-dim text-center mt-2">
          Stream active — tap to join
        </div>
      )}
    </div>
  );
}
