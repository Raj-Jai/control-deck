import { useState, useRef, useCallback } from 'react';
import {
  Music,
  SkipBack,
  Play,
  Pause,
  SkipForward,
} from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand, seekTo } from '../services/apiService';

interface NowPlayingCardProps {
  state: MediaState | null;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingCard({ state }: NowPlayingCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const artLoadedRef = useRef(false);
  const [artError, setArtError] = useState(false);

  const isOffline = !state?.title;
  const status = state?.status ?? 'Stopped';
  const pos = state?.position ?? 0;
  const len = state?.length ?? 0;
  const artUrl = state?.art_url ?? null;

  const displayTitle = isOffline ? 'No Track' : state.title;
  const displayArtist = isOffline ? 'Idle / Disconnected' : state.artist ?? 'Unknown Artist';

  const handleSeek = useCallback((val: number) => {
    seekTo(val);
  }, []);

  return (
    <div className="deck-card flex flex-col gap-3.5">
      {/* Art + Info row */}
      <div className="flex items-center gap-3">
        {/* Album art */}
        <div className="relative w-[72px] h-[72px] rounded-xl overflow-hidden flex-shrink-0 bg-deck-surface2">
          {artUrl && !artError ? (
            <img
              src={artUrl}
              alt=""
              className="w-full h-full object-cover"
              onLoad={() => { artLoadedRef.current = true; setArtError(false); }}
              onError={() => setArtError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-deck-dim">
              <Music size={28} />
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate">{displayTitle}</h2>
          <p className="text-xs text-deck-dim truncate mt-0.5">{displayArtist}</p>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium mt-1.5 px-2 py-0.5 rounded-full ${
              isOffline
                ? 'bg-deck-surface2 text-deck-muted'
                : status === 'Playing'
                ? 'bg-deck-accent/15 text-deck-accent'
                : 'bg-yellow-500/15 text-yellow-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isOffline
                  ? 'bg-deck-muted'
                  : status === 'Playing'
                  ? 'bg-deck-accent'
                  : 'bg-yellow-400'
              }`}
            />
            {isOffline ? 'Offline' : status}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <input
          type="range"
          min={0}
          max={len > 0 ? Math.floor(len) : 100}
          value={isDragging ? dragValue : Math.floor(pos)}
          onChange={(e) => {
            setIsDragging(true);
            setDragValue(Number(e.target.value));
          }}
          onMouseUp={() => {
            if (isDragging) {
              setIsDragging(false);
              handleSeek(dragValue);
            }
          }}
          onTouchEnd={() => {
            if (isDragging) {
              setIsDragging(false);
              handleSeek(dragValue);
            }
          }}
          className="w-full"
          disabled={isOffline}
        />
        <div className="flex justify-between text-[11px] text-deck-dim mt-1">
          <span>{formatTime(pos)}</span>
          <span>{len > 0 ? formatTime(len) : '--:--'}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="flex justify-center items-center gap-3">
        <button className="media-btn" onClick={() => triggerCommand('previous')} disabled={isOffline}>
          <SkipBack size={18} />
        </button>
        <button
          className="media-btn w-12 h-12"
          onClick={() => triggerCommand('playpause')}
          disabled={isOffline}
        >
          {status === 'Playing' ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="media-btn" onClick={() => triggerCommand('next')} disabled={isOffline}>
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
}
