import { useState } from 'react';
import { Music, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand } from '../services/apiService';

interface MiniPlayerProps {
  state: MediaState | null;
}

export default function MiniPlayer({ state }: MiniPlayerProps) {
  const [artError, setArtError] = useState(false);
  const title = state?.title || 'No Track';
  const artist = state?.artist || '';
  const artUrl = state?.art_url;
  const isPlaying = state?.status === 'Playing';
  const hasTrack = !!state?.title;

  return (
    <div className="fixed bottom-14 left-0 right-0 z-40 bg-deck-bg/80 backdrop-blur-md border-t border-white/[0.04] px-3 py-1.5">
      <div className="max-w-6xl mx-auto flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0 bg-deck-surface2 flex items-center justify-center">
          {artUrl && !artError ? (
            <img src={artUrl} alt="" className="w-full h-full object-cover"
              onError={() => setArtError(true)} />
          ) : (
            <Music size={16} className="text-deck-dim" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold truncate text-deck-text">
            {hasTrack ? title : 'No Track Playing'}
          </div>
          <div className="text-[10px] text-deck-dim truncate">
            {hasTrack ? artist : 'Idle'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="icon-btn w-8 h-8" onClick={() => triggerCommand('previous')}
            disabled={!hasTrack}><SkipBack size={14} /></button>
          <button className="icon-btn w-9 h-9" onClick={() => triggerCommand('playpause')}
            disabled={!hasTrack}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="icon-btn w-8 h-8" onClick={() => triggerCommand('next')}
            disabled={!hasTrack}><SkipForward size={14} /></button>
        </div>
      </div>
    </div>
  );
}
