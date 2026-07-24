import { useEffect, useState } from 'react';
import { Radio, RadioTower } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import * as streamManager from '../lib/streamManager';

interface Props {
  state: MediaState | null;
  compact?: boolean;
}

export default function AudioStreamCard({ state, compact }: Props) {
  const [local, setLocal] = useState<'idle' | 'playing' | 'active_elsewhere'>('idle');

  useEffect(() => {
    return streamManager.subscribe(active => {
      setLocal(active ? 'playing' : 'idle');
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    setLocal(prev => {
      if (state.audio_stream_active && prev === 'idle') return 'active_elsewhere';
      if (!state.audio_stream_active && prev === 'active_elsewhere') return 'idle';
      return prev;
    });
  }, [state?.audio_stream_active]);

  const handleToggle = () => {
    if (local === 'playing' || local === 'active_elsewhere') {
      streamManager.stop();
      return;
    }
    streamManager.start();
  };

  const isActive = local === 'playing';
  const isJoinable = local === 'active_elsewhere';
  const label = isActive ? 'Stop' : isJoinable ? 'Join' : 'Stream';
  const Icon = (isActive || isJoinable) ? RadioTower : Radio;

  if (compact) {
    return (
      <button
        className={`media-btn relative ${isActive ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent' : ''} ${isJoinable ? 'text-yellow-400' : ''}`}
        onClick={handleToggle}
        title={label}
      >
        <span className={isActive ? 'animate-pulse' : ''}>
          <Icon size={16} />
        </span>
      </button>
    );
  }

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
