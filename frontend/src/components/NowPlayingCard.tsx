import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
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
  Volume2,
} from 'lucide-react';
import type { MediaState, PlayerState } from '../hooks/useMediaStream';
import { triggerCommand, seekTo, setVolume, sliderToValue, valueToSlider } from '../services/apiService';
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
  const modalRef = useRef<HTMLDivElement>(null);

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

  // Scroll active line into view when modal opens or active line changes
  useEffect(() => {
    if (!showFullLyrics || activeIdx < 0 || !lyricsContainerRef.current) return;
    const container = lyricsContainerRef.current;
    const activeEl = container.querySelector('.lyric-line.active') as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx, showFullLyrics]);

  // Disable body scroll when modal is open
  useEffect(() => {
    if (showFullLyrics) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showFullLyrics]);

  // rAF sync loop for compact view
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

  // Extra rAF sync loop for fullscreen modal ONLY (separate so we can keep it alive)
  useEffect(() => {
    if (!showFullLyrics || !hasSynced || lyricLines.length === 0 || !player) return;
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
  }, [showFullLyrics, hasSynced, lyricLines, player?.id, localPos, pos]);

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
  const prevLineText = activeIdx > 0 ? lyricLines[activeIdx - 1].text : '';
  const currentLineText = activeIdx >= 0 && activeIdx < lyricLines.length
    ? lyricLines[activeIdx].text
    : hasSynced && lyricLines.length > 0
      ? lyricLines[0].text
      : '';
  const nextLineText = activeIdx >= 0 && activeIdx < lyricLines.length - 1
    ? lyricLines[activeIdx + 1].text
    : '';
  const showTicker = hasSynced && lyricLines.length > 0;

  // Shared seekbar
  const seekbar = (
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
  );

  // Shared play controls row
  const playControls = (large?: boolean) => {
    const s = large ? 24 : 18;
    const btnSize = large ? 'w-12 h-12' : '';
    return (
      <>
        <button className="media-btn" onClick={() => triggerCommand('previous', playerId)} disabled={isOffline || isIdle}>
          <SkipBack size={s} />
        </button>
        <button className="media-btn" onClick={() => triggerCommand('seekBack10', playerId)} disabled={isOffline || isIdle}>
          <Rewind size={Math.round(s * 0.9)} />
        </button>
        <button
          className={`media-btn ${large ? 'w-14 h-14' : 'w-12 h-12'}`}
          onClick={() => triggerCommand('playpause', playerId)}
          disabled={isOffline || isIdle}
        >
          {status === 'Playing' ? <Pause size={large ? 26 : 20} /> : <Play size={large ? 26 : 20} />}
        </button>
        <button className="media-btn" onClick={() => triggerCommand('seekFwd10', playerId)} disabled={isOffline || isIdle}>
          <FastForward size={Math.round(s * 0.9)} />
        </button>
        <button className="media-btn" onClick={() => triggerCommand('next', playerId)} disabled={isOffline || isIdle}>
          <SkipForward size={s} />
        </button>
      </>
    );
  };

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
        <div className="relative flex flex-col items-center justify-center h-[76px] px-8 overflow-hidden text-center rounded-xl"
          style={{
            background: 'rgba(30, 41, 59, 0.55)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="w-full lyric-prev text-[0.82rem] opacity-[0.45] text-deck-dim truncate transition-all duration-300 ease-out">
            {prevLineText}
          </div>
          <div
            className="w-full lyric-current text-[1.1rem] font-bold truncate transition-all duration-300 ease-out my-[2px]"
            style={{
              color: 'var(--art-primary, #00f2fe)',
              textShadow: '0 0 14px color-mix(in srgb, var(--art-primary, #00f2fe) 40%, transparent)',
            }}
          >
            {currentLineText}
          </div>
          <div className="w-full lyric-next text-[0.82rem] opacity-[0.45] text-deck-dim truncate transition-all duration-300 ease-out">
            {nextLineText}
          </div>

          <button
            onClick={() => setShowFullLyrics(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-deck-dim opacity-60 hover:opacity-100 hover:text-[var(--art-primary,#00f2fe)] cursor-pointer transition-all duration-200 p-1"
            title="Full lyrics"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {/* Plain lyrics fallback */}
      {!showTicker && !isInstrumental && lyricsData?.plain_lyrics && (
        <div className="relative flex items-center justify-center h-[52px] px-8 overflow-hidden text-center rounded-xl"
          style={{
            background: 'rgba(30, 41, 59, 0.55)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="text-xs text-deck-dim/70 truncate max-w-full">
            {lyricsData.plain_lyrics.split('\n')[0]}
          </div>
          <button
            onClick={() => setShowFullLyrics(true)}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-deck-dim opacity-60 hover:opacity-100 hover:text-[var(--art-primary,#00f2fe)] cursor-pointer transition-all duration-200 p-1"
            title="Full lyrics"
          >
            <Maximize2 size={16} />
          </button>
        </div>
      )}

      {/* Instrumental badge */}
      {isInstrumental && (
        <div className="flex items-center justify-center h-[52px] rounded-xl"
          style={{
            background: 'rgba(30, 41, 59, 0.55)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span className="text-xs text-deck-muted italic">Instrumental Track</span>
        </div>
      )}

      {/* Timeline + seekbar */}
      {seekbar}

      {/* Controls */}
      <div className="flex justify-center items-center gap-3">
        {playControls()}
        {state && <AudioStreamCard state={state} compact />}
      </div>

      {/* Fullscreen lyrics modal — portal to body to escape deck-card stacking context */}
      {showFullLyrics && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col md:flex-row"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen lyrics"
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(24px)',
          }}
        >
          {/* Close button (top-right, always visible) */}
          <button
            onClick={() => setShowFullLyrics(false)}
            className="fixed top-4 right-4 z-[60] w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.08] border border-white/[0.12] text-deck-dim hover:text-white hover:bg-white/[0.14] transition-all duration-200 cursor-pointer"
          >
            <X size={20} />
          </button>

          {/* Left panel: art + controls (desktop) / top panel (mobile) */}
          <div className="flex flex-col items-center justify-center gap-5 p-6 md:p-10 md:w-[360px] md:min-w-[360px] md:h-full md:border-r border-white/[0.06]">
            {/* Album art */}
            <div className="relative w-[180px] h-[180px] md:w-[240px] md:h-[240px] rounded-2xl overflow-hidden flex-shrink-0 shadow-2xl bg-deck-surface2">
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
                  <Music size={64} />
                </div>
              )}
            </div>

            {/* Track info */}
            <div className="text-center max-w-full">
              <h2 className="text-lg md:text-xl font-bold truncate">{displayTitle}</h2>
              <p className="text-sm text-deck-dim truncate mt-1">{displayArtist}</p>
            </div>

            {/* Seekbar */}
            <div className="w-full max-w-[320px]">
              {seekbar}
            </div>

            {/* Play controls */}
            <div className="flex justify-center items-center gap-3">
              {playControls(true)}
              {state && <AudioStreamCard state={state} compact />}
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2 w-full max-w-[200px]">
              <Volume2 size={16} className="text-deck-dim flex-shrink-0" />
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(valueToSlider(state?.volume ?? 0, 1) * 100)}
                onChange={(e) => setVolume(sliderToValue(parseInt(e.target.value) / 100, 1))}
                className="w-full"
                disabled={isOffline || isIdle}
              />
            </div>
          </div>

          {/* Right panel: full scrollable lyrics */}
          <div className="flex-1 flex flex-col min-h-0 p-4 md:p-8 overflow-hidden">
            <div className="text-center mb-1">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-deck-muted/50">Lyrics</h3>
              {lyricsData?.track_id && (
                <div className="text-[9px] text-deck-muted/20 tracking-wider mt-0.5 select-none">
                  {lyricsData.track_id}
                </div>
              )}
            </div>
            <div
              ref={lyricsContainerRef}
              className="flex-1 overflow-y-auto px-2 md:px-8 py-4 scroll-smooth"
              style={{
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 92%, transparent 100%)',
              }}
            >
              {isInstrumental ? (
                <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">Instrumental Track</div>
              ) : lyricLines.length > 0 ? (
                <div className="flex flex-col gap-3 md:gap-4 items-center">
                  {lyricLines.map((line, i) => {
                    const isActive = i === activeIdx;
                    const isPast = i < activeIdx;
                    return (
                      <div
                        key={line.id}
                        className={`lyric-line text-center leading-snug transition-all duration-500 ease-out ${
                          isActive
                            ? 'active scale-[1.06] font-bold text-base md:text-lg'
                            : isPast
                            ? 'opacity-25 scale-[0.95] text-sm md:text-base'
                            : 'opacity-35 scale-[0.97] text-sm md:text-base'
                        }`}
                        style={isActive ? {
                          color: 'var(--art-primary, #00f2fe)',
                          textShadow: '0 0 24px color-mix(in srgb, var(--art-primary, #00f2fe) 50%, transparent)',
                        } : {
                          color: 'var(--art-primary, #94a3b8)',
                        }}
                      >
                        {line.text || '\u00A0'}
                      </div>
                    );
                  })}
                </div>
              ) : lyricsData?.plain_lyrics ? (
                <div className="text-sm md:text-base text-deck-dim/80 whitespace-pre-wrap leading-relaxed text-center max-w-2xl mx-auto">
                  {lyricsData.plain_lyrics}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-deck-muted text-sm italic">No lyrics available</div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
