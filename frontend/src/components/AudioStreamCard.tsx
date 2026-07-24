import { useRef, useEffect, useState } from 'react';
import { Radio, RadioTower, Loader2 } from 'lucide-react';
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

  const handleToggle = () => {
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

    audio.play().then(() => {
      if (aliveRef.current) setLocal('playing');
    }).catch(() => {
      if (!aliveRef.current) return;
      setLocal('idle');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setLocal('idle'); }, 3000);
    });
  };

  const isActive = local === 'playing';
  const isJoinable = local === 'active_elsewhere';
  const label = isActive ? 'Stop' : isJoinable ? 'Join' : 'Stream';
  const Icon = (isActive || isJoinable) ? RadioTower : Radio;

  return (
    <div
      className={`toggle-card ${isActive ? 'active' : ''} ${isJoinable ? 'ring-1 ring-yellow-500/30' : ''}`}
      onClick={handleToggle}
    >
      <span className={`text-[28px] leading-none ${isActive ? 'animate-pulse' : ''}`}>
        <Icon size={28} />
      </span>
      <span className="toggle-label text-xs font-semibold text-center leading-tight">
        {label}
      </span>
    </div>
  );
}
