import { useRef, useState, useEffect } from 'react';
import {
  Music,
  SkipBack,
  Rewind,
  FastForward,
  Play,
  Pause,
  SkipForward,
} from 'lucide-react';
import type { MediaState, PlayerState } from '../hooks/useMediaStream';
import { triggerCommand, seekTo } from '../services/apiService';
import AudioStreamCard from './AudioStreamCard';
import { parseLRC, getActiveLineIndex } from '../lib/lyricsEngine';
import type { LyricLine } from '../lib/lyricsEngine';

interface NowPlayingCardProps {
  player: PlayerState | null;
  state?: MediaState | null;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingCard({ player, state }: NowPlayingCardProps) {
  const dragging = useRef(false);
  const seekRef = useRef(0);
  const [localPos, setLocalPos] = useState<number | null>(null);
  const [artError, setArtError] = useState(false);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [lyricTab, setLyricTab] = useState(0);
  const activeIdxRef = useRef(-1);

  const isOffline = !player;
  const isIdle = !!player && !player.title && player.status !== 'Playing' && player.status !== 'Paused';
  const status = isOffline ? 'Stopped' : (player.status || 'Stopped');
  const pos = player?.position ?? 0;
  const len = player?.length ?? 0;
  const artUrl = player?.art_url ?? null;
  const playerId = player?.id;

  const lyricsData = state?.lyrics ?? null;
  const hasSynced = !!lyricsData?.synced_lyrics;
  const isInstrumental = lyricsData?.instrumental ?? false;
  const hasLyrics = hasSynced || !!lyricsData?.plain_lyrics;

  // Parse LRC on track change
  useEffect(() => {
    if (hasSynced) {
      setLyricLines(parseLRC(lyricsData!.synced_lyrics));
    } else {
      setLyricLines([]);
    }
    setActiveIdx(-1);
    activeIdxRef.current = -1;
    if (lyricsContainerRef.current) {
      lyricsContainerRef.current.scrollTop = 0;
    }
  }, [lyricsData?.track_id]);

  // rAF sync loop - uses ref to avoid dependency issues
  useEffect(() => {
    if (!hasSynced || lyricLines.length === 0 || !player) return;
    let rafId: number;
    const tick = () => {
      const ms = (localPos !== null ? localPos : pos) * 1000;
      const idx = getActiveLineIndex(lyricLines, ms);
      if (idx !== activeIdxRef.current) {
        activeIdxRef.current = idx;
        setActiveIdx(idx);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasSynced, lyricLines, player?.id, localPos, pos]);

  // Auto-scroll active line to center
  useEffect(() => {
    if (activeIdx < 0 || !lyricsContainerRef.current) return;
    const container = lyricsContainerRef.current;
    const activeEl = container.querySelector('.lyric-line.active') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx]);

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

  const isPlaying = !isOffline && !isIdle && status === 'Playing';
  const cardBorder = isPlaying
    ? 'border-deck-accent/20 shadow-[0_0_24px_rgba(6,182,212,0.08)]'
    : '';

  // Shared lyrics content
  const renderLyrics = () => {
    if (isInstrumental) {
      return <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">Instrumental Track</div>;
    }
    if (lyricLines.length > 0) {
      return (
        <div className="flex flex-col gap-2 py-8">
          {lyricLines.map((line, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={line.id}
                className={`lyric-line transition-all duration-400 ease-out text-center leading-snug text-sm ${
                  isActive
                    ? 'active scale-[1.05] font-bold'
                    : 'opacity-30 scale-[0.96] blur-[0.5px]'
                }`}
                style={isActive ? {
                  color: 'var(--art-primary, #00f2fe)',
                  textShadow: '0 0 16px var(--art-primary, #00f2fe)',
                } : {}}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      );
    }
    if (lyricsData?.plain_lyrics) {
      return (
        <div className="text-sm text-deck-dim/80 whitespace-pre-wrap leading-relaxed py-4 px-1">
          {lyricsData.plain_lyrics}
        </div>
      );
    }
    return <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">No lyrics available</div>;
  };

  const lyricsViewport = (
    <div
      ref={lyricsContainerRef}
      className="h-[280px] overflow-y-auto scrollbar-none"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 15%, black 85%, transparent)',
      }}
    >
      {renderLyrics()}
    </div>
  );

  return (
    <div className={`deck-card flex flex-col gap-3 transition-all duration-300 ${cardBorder}`}>
      {/* Desktop: dual-panel */}
      <div className="hidden md:flex md:flex-row md:gap-4">
        {/* Left: player controls */}
        <div className="flex flex-col gap-3 min-w-0 md:w-[40%] flex-shrink-0">
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
                  className={`status-dot ${
                    isOffline || isIdle
                      ? 'bg-deck-muted'
                      : status === 'Playing'
                      ? 'playing'
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
            <button className="media-btn" onClick={() => triggerCommand('seekBack10', playerId)} disabled={isOffline || isIdle}>
              <Rewind size={16} />
            </button>
            <button
              className="media-btn w-12 h-12"
              onClick={() => triggerCommand('playpause', playerId)}
              disabled={isOffline || isIdle}
            >
              {status === 'Playing' ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button className="media-btn" onClick={() => triggerCommand('seekFwd10', playerId)} disabled={isOffline || isIdle}>
              <FastForward size={16} />
            </button>
            <button className="media-btn" onClick={() => triggerCommand('next', playerId)} disabled={isOffline || isIdle}>
              <SkipForward size={18} />
            </button>
            {state && <AudioStreamCard state={state} compact />}
          </div>
        </div>

        {/* Right: lyrics */}
        {hasLyrics && !isInstrumental && (
          <div className="flex-1 min-w-0 border-l border-white/[0.06] pl-4">
            {lyricsViewport}
          </div>
        )}
      </div>

      {/* Mobile: tabbed player/lyrics */}
      <div className="md:hidden">
        {hasLyrics && !isInstrumental ? (
          <>
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setLyricTab(0)}
                className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md transition-all ${
                  lyricTab === 0 ? 'bg-deck-accent/15 text-deck-accent' : 'text-deck-muted/50'
                }`}
              >
                Player
              </button>
              <button
                onClick={() => setLyricTab(1)}
                className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md transition-all ${
                  lyricTab === 1 ? 'bg-deck-accent/15 text-deck-accent' : 'text-deck-muted/50'
                }`}
              >
                Lyrics
              </button>
            </div>
            {lyricTab === 1 ? (
              lyricsViewport
            ) : null}
          </>
        ) : null}

        {/* Always show player controls on mobile (when lyrics tab is active, player is hidden; when player tab, show) */}
        {lyricTab !== 1 && (
          <>
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
                    className={`status-dot ${
                      isOffline || isIdle
                        ? 'bg-deck-muted'
                        : status === 'Playing'
                        ? 'playing'
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
              <button className="media-btn" onClick={() => triggerCommand('seekBack10', playerId)} disabled={isOffline || isIdle}>
                <Rewind size={16} />
              </button>
              <button
                className="media-btn w-12 h-12"
                onClick={() => triggerCommand('playpause', playerId)}
                disabled={isOffline || isIdle}
              >
                {status === 'Playing' ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="media-btn" onClick={() => triggerCommand('seekFwd10', playerId)} disabled={isOffline || isIdle}>
                <FastForward size={16} />
              </button>
              <button className="media-btn" onClick={() => triggerCommand('next', playerId)} disabled={isOffline || isIdle}>
                <SkipForward size={18} />
              </button>
              {state && <AudioStreamCard state={state} compact />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
