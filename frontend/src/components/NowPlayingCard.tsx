import { useRef, useState, useEffect } from 'react';
import {
  Music,
  SkipBack,
  Rewind,
  FastForward,
  Play,
  Pause,
  SkipForward,
  Maximize2,
  X,
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
  const activeIdxRef = useRef(-1);
  const [showFullLyrics, setShowFullLyrics] = useState(false);

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
  }, [lyricsData?.track_id]);

  // rAF sync loop
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

  // Auto-scroll active line to center in modal
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

  // 3-line ticker state
  const prevLine = activeIdx > 0 ? lyricLines[activeIdx - 1].text : '';
  const currentLine = activeIdx >= 0 && activeIdx < lyricLines.length
    ? lyricLines[activeIdx].text
    : hasSynced && lyricLines.length > 0
      ? lyricLines[0].text
      : '';
  const nextLine = activeIdx >= 0 && activeIdx < lyricLines.length - 1
    ? lyricLines[activeIdx + 1].text
    : '';
  const showTicker = hasSynced && lyricLines.length > 0;

  return (
    <div className={`deck-card flex flex-col gap-3 transition-all duration-300 ${cardBorder}`}>
      {/* Header: art + metadata */}
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

      {/* 3-line inline lyrics ticker */}
      {showTicker && !isInstrumental && (
        <div className="relative flex flex-col items-center justify-center h-[76px] mx-0 px-8 overflow-hidden text-center bg-white/[0.04] rounded-lg">
          <div className="w-full lyric-line lyric-prev text-[0.82rem] opacity-[0.45] text-deck-dim truncate transition-all duration-300">
            {activeIdx > 0 ? lyricLines[activeIdx - 1].text : ''}
          </div>
          <div
            className="w-full lyric-line lyric-current text-[1.1rem] font-bold truncate transition-all duration-300 my-[2px]"
            style={{
              color: 'var(--art-primary, #00f2fe)',
              textShadow: '0 0 12px var(--art-primary, #00f2fe)',
            }}
          >
            {currentLine}
          </div>
          <div className="w-full lyric-line lyric-next text-[0.82rem] opacity-[0.45] text-deck-dim truncate transition-all duration-300">
            {nextLine}
          </div>

          <button
            onClick={() => setShowFullLyrics(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-deck-dim opacity-70 hover:opacity-100 hover:text-[var(--art-primary,#00f2fe)] cursor-pointer transition-all duration-200"
            title="Full lyrics"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {/* Plain lyrics fallback when no synced */}
      {!showTicker && hasLyrics && lyricsData?.plain_lyrics && !isInstrumental && (
        <div className="relative flex items-center justify-center h-[52px] mx-0 px-8 overflow-hidden text-center bg-white/[0.04] rounded-lg">
          <div className="text-xs text-deck-dim/70 truncate max-w-full">
            {lyricsData.plain_lyrics.split('\n')[0]}
          </div>
          <button
            onClick={() => setShowFullLyrics(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-deck-dim opacity-70 hover:opacity-100 cursor-pointer transition-all duration-200"
            title="Full lyrics"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {/* Instrumental badge */}
      {isInstrumental && (
        <div className="flex items-center justify-center h-[52px] mx-0 bg-white/[0.04] rounded-lg">
          <span className="text-xs text-deck-muted italic">Instrumental Track</span>
        </div>
      )}

      {/* Timeline + seekbar */}
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

      {/* Controls */}
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

      {/* Full lyrics modal */}
      {showFullLyrics && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowFullLyrics(false); }}
        >
          <div className="relative w-[90vw] max-w-lg max-h-[80vh] bg-deck-surface border border-white/[0.08] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-sm font-semibold truncate">{displayTitle}</h3>
              <button
                onClick={() => setShowFullLyrics(false)}
                className="text-deck-dim hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div
              ref={lyricsContainerRef}
              className="flex-1 overflow-y-auto px-4 py-6"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)',
              }}
            >
              {isInstrumental ? (
                <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">Instrumental Track</div>
              ) : lyricLines.length > 0 ? (
                <div className="flex flex-col gap-3">
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
              ) : lyricsData?.plain_lyrics ? (
                <div className="text-sm text-deck-dim/80 whitespace-pre-wrap leading-relaxed">
                  {lyricsData.plain_lyrics}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">No lyrics available</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
