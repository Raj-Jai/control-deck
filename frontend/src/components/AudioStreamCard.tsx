import { useState, useRef, useEffect } from 'react';
import { Radio, RadioTower, Loader2 } from 'lucide-react';
import { getAudioStreamStatus } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';

interface Props {
  state: MediaState | null;
}

export default function AudioStreamCard({ state }: Props) {
  const [local, setLocal] = useState<'idle' | 'playing' | 'active_elsewhere'>('idle');
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const aliveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  // Sync with SSE state
  useEffect(() => {
    if (!state) return;
    setLocal(prev => {
      if (state.audio_stream_active && prev === 'idle') return 'active_elsewhere';
      if (!state.audio_stream_active && prev === 'active_elsewhere') return 'idle';
      return prev;
    });
  }, [state?.audio_stream_active]);

  const cleanup = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current = null;
    }
  };

  const handleToggle = async () => {
    if (local === 'playing' || local === 'active_elsewhere') {
      setLocal('idle');
      cleanup();
      return;
    }

    cleanup();

    const audio = new Audio();
    audioRef.current = audio;
    audio.src = '/api/audio-stream/stream';
    audio.preload = 'auto';

    audio.onerror = () => {
      if (!aliveRef.current) return;
      setLocal('idle');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setLocal('idle'); }, 3000);
    };

    audio.onended = () => {
      if (!aliveRef.current) return;
      setLocal('idle');
      cleanup();
    };

    try {
      await audio.play();
      if (aliveRef.current) setLocal('playing');
    } catch {
      if (!aliveRef.current) return;
      setLocal('idle');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setLocal('idle'); }, 3000);
    }
  };

  const busy = false;
  const Icon = local === 'playing' ? RadioTower : Radio;
  const label =
    local === 'idle' ? 'Stream Audio' :
    local === 'playing' ? 'Stop Stream' :
    local === 'active_elsewhere' ? 'Join Stream' :
    'Stream Audio';

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
          ${local === 'playing'
            ? 'bg-red-500/15 border-red-500/30 text-red-400 hover:bg-red-500/20'
            : 'bg-deck-surface2 border-white/5 text-deck-text hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent'
          }
          disabled:opacity-50 disabled:pointer-events-none`}
      >
        <span className={local === 'playing' ? 'animate-pulse' : ''}>
          <Icon size={16} />
        </span>
        {label}
      </button>
      {local === 'playing' && (
        <div className="text-[10px] text-deck-dim text-center mt-2">
          Streaming MP3 — ~2s latency
        </div>
      )}
      {local === 'active_elsewhere' && (
        <div className="text-[10px] text-deck-dim text-center mt-2">
          Stream active — tap to join
        </div>
      )}
    </div>
  );
}
