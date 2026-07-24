import { useRef, useState, useEffect } from 'react';
import {
  Music,
  SkipBack,
  Play,
  Pause,
  SkipForward,
} from 'lucide-react';
import type { PlayerState } from '../hooks/useMediaStream';
import { triggerCommand, seekTo } from '../services/apiService';

interface NowPlayingCardProps {
  player: PlayerState | null;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingCard({ player }: NowPlayingCardProps) {
  const dragging = useRef(false);
  const seekRef = useRef(0);
  const [localPos, setLocalPos] = useState<number | null>(null);
  const [artError, setArtError] = useState(false);

  const isOffline = !player;
  const isIdle = !!player && !player.title && player.status !== 'Playing' && player.status !== 'Paused';
  const status = isOffline ? 'Stopped' : (player.status || 'Stopped');
  const pos = player?.position ?? 0;
  const len = player?.length ?? 0;
  const artUrl = player?.art_url ?? null;
  const playerId = player?.id;

  if (localPos !== null && seekRef.current !== 0 && Math.abs(pos - seekRef.current) < 2) {
    seekRef.current = 0;
    setLocalPos(null);
  }

  const displayVal = localPos !== null ? localPos : Math.floor(pos);

  const displayTitle = isOffline ? 'No Track' : (player.title || 'Idle');
  const displayArtist = isOffline ? 'Idle / Disconnected' : (player.artist || '');

  const commitSeek = (v: number) => {
    dragging.current = false;
    seekRef.current = v;
    setLocalPos(v);
    seekTo(v, playerId);
  };

  return (
    <div className="deck-card flex flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <div className="relative w-[72px] h-[72px] rounded-xl overflow-hidden flex-shrink-0 bg-deck-surface2">
          {artUrl && !artError ? (
            <img
              src={artUrl}
              alt=""
              className="w-full h-full object-cover"
              onLoad={() => setArtError(false)}
              onError={() => setArtError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-deck-dim">
              <Music size={28} />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold truncate">{displayTitle}</h2>
          <p className="text-xs text-deck-dim truncate mt-0.5">{displayArtist}</p>
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-medium mt-1.5 px-2 py-0.5 rounded-full ${
              isOffline || isIdle
                ? 'bg-deck-surface2 text-deck-muted'
                : status === 'Playing'
                ? 'bg-deck-accent/15 text-deck-accent'
                : 'bg-yellow-500/15 text-yellow-400'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isOffline || isIdle
                  ? 'bg-deck-muted'
                  : status === 'Playing'
                  ? 'bg-deck-accent'
                  : 'bg-yellow-400'
              }`}
            />
            {isOffline ? 'Offline' : isIdle ? 'Idle' : status}
          </span>
        </div>
      </div>

      <div>
        <input
          type="range"
          min={0}
          max={len > 0 ? Math.floor(len) : 100}
          value={displayVal}
          onChange={(e) => {
            const v = Number(e.target.value);
            dragging.current = true;
            setLocalPos(v);
          }}
          onMouseUp={() => commitSeek(localPos !== null ? localPos : Math.floor(pos))}
          onTouchEnd={() => commitSeek(localPos !== null ? localPos : Math.floor(pos))}
          className="w-full"
          disabled={isOffline || isIdle}
        />
        <div className="flex justify-between text-[11px] text-deck-dim mt-1">
          <span>{formatTime(displayVal)}</span>
          <span>{len > 0 ? formatTime(len) : '--:--'}</span>
        </div>
      </div>

      <div className="flex justify-center items-center gap-3">
        <button className="media-btn" onClick={() => triggerCommand('previous', playerId)} disabled={isOffline || isIdle}>
          <SkipBack size={18} />
        </button>
        <button
          className="media-btn w-12 h-12"
          onClick={() => triggerCommand('playpause', playerId)}
          disabled={isOffline || isIdle}
        >
          {status === 'Playing' ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="media-btn" onClick={() => triggerCommand('next', playerId)} disabled={isOffline || isIdle}>
          <SkipForward size={18} />
        </button>
      </div>
    </div>
  );
}
