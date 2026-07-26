import { useRef, useState, useEffect } from 'react';
import { Music, Radio, RadioTower, Lock, Play } from 'lucide-react';
import type { MediaState, PlayerState } from '../hooks/useMediaStream';
import * as streamManager from '../lib/streamManager';
import { parseLRC, getActiveLineIndex } from '../lib/lyricsEngine';
import type { LyricLine } from '../lib/lyricsEngine';

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface GuestViewProps {
  state: MediaState | null | undefined;
  onExit: () => void;
}

export default function GuestView({ state, onExit }: GuestViewProps) {
  const player = state?.players?.find(p => p.status === 'Playing') || state?.players?.[0] || null;
  const artUrl = player?.art_url ?? state?.art_url ?? null;
  const pos = player?.position ?? 0;
  const len = player?.length ?? 0;
  const progressPct = len > 0 ? Math.min((pos / len) * 100, 100) : 0;

  const [streamState, setStreamState] = useState<'idle' | 'playing' | 'active_elsewhere'>('idle');
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [artError, setArtError] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return streamManager.subscribe(active => {
      setStreamState(active ? 'playing' : 'idle');
    });
  }, []);

  useEffect(() => {
    setStreamState(prev => {
      if (!state) return prev;
      if (state.audio_stream_active && prev === 'idle') return 'active_elsewhere';
      if (!state.audio_stream_active && prev === 'active_elsewhere') return 'idle';
      return prev;
    });
  }, [state?.audio_stream_active]);

  useEffect(() => {
    if (!state?.lyrics?.synced_lyrics) { setLyricLines([]); return; }
    setLyricLines(parseLRC(state.lyrics.synced_lyrics));
  }, [state?.lyrics?.synced_lyrics]);

  useEffect(() => {
    if (lyricLines.length === 0) return;
    const ms = pos * 1000;
    const idx = getActiveLineIndex(lyricLines, ms);
    setActiveIdx(idx);
  }, [pos, lyricLines]);

  useEffect(() => {
    const el = lyricsRef.current;
    if (!el || activeIdx < 0) return;
    const child = el.children[1] as HTMLElement;
    if (child) child.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

  const prevLine = activeIdx > 0 ? lyricLines[activeIdx - 1] : null;
  const currLine = activeIdx >= 0 && activeIdx < lyricLines.length ? lyricLines[activeIdx] : null;
  const nextLine = activeIdx >= 0 && activeIdx + 1 < lyricLines.length ? lyricLines[activeIdx + 1] : null;

  const isStreamActive = streamState === 'playing';
  const isJoinable = streamState === 'active_elsewhere';

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0b0d12] p-6 gap-6">
      <button
        onClick={onExit}
        className="fixed top-4 left-4 z-50 w-9 h-9 rounded-lg bg-black/40 backdrop-blur border border-white/10
          flex items-center justify-center text-deck-dim hover:text-deck-accent hover:border-deck-accent/30
          transition-all active:scale-90"
        title="Exit guest mode"
      >
        <Lock size={15} />
      </button>

      <div className="w-48 h-48 md:w-56 md:h-56 rounded-2xl overflow-hidden bg-deck-surface2 shadow-2xl flex-shrink-0">
        {artUrl && !artError ? (
          <img src={artUrl} alt="" className="w-full h-full object-cover" onError={() => setArtError(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music size={48} className="text-deck-dim/40" />
          </div>
        )}
      </div>

      <div className="text-center max-w-sm">
        <div className="text-lg font-semibold text-deck-text truncate">
          {player?.title || state?.title || 'No track'}
        </div>
        <div className="text-sm text-deck-dim truncate mt-0.5">
          {player?.artist || state?.artist || ''}
        </div>
      </div>

      {/* Read-only progress bar */}
      <div className="w-full max-w-md flex items-center gap-3">
        <span className="text-[11px] text-deck-dim tabular-nums w-10 text-right">{formatTime(pos)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full bg-deck-accent/50 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="text-[11px] text-deck-dim tabular-nums w-10">{formatTime(len)}</span>
      </div>

      {/* Lyrics ticker */}
      {lyricLines.length > 0 && (
        <div ref={lyricsRef} className="w-full max-w-md flex flex-col items-center gap-1.5 min-h-[72px] justify-center">
          <div className="text-sm text-deck-dim/50 transition-all duration-200 line-clamp-1">{prevLine?.text || '\u00A0'}</div>
          <div className="text-base font-semibold text-deck-text transition-all duration-200 text-center line-clamp-1">{currLine?.text || '\u00A0'}</div>
          <div className="text-sm text-deck-dim/50 transition-all duration-200 line-clamp-1">{nextLine?.text || '\u00A0'}</div>
        </div>
      )}

      {!lyricLines.length && state?.lyrics?.plain_lyrics && (
        <div className="w-full max-w-md text-sm text-deck-dim/70 text-center leading-relaxed line-clamp-3">
          {state.lyrics.plain_lyrics}
        </div>
      )}

      {/* Stream button */}
      <button
        onClick={() => {
          if (isStreamActive || isJoinable) { streamManager.stop(); return; }
          streamManager.start();
        }}
        className={`px-8 py-3 rounded-xl text-sm font-semibold flex items-center gap-2.5 transition-all active:scale-95
          ${isStreamActive
            ? 'bg-deck-accent/15 border border-deck-accent/30 text-deck-accent'
            : isJoinable
            ? 'bg-yellow-500/15 border border-yellow-500/30 text-yellow-400'
            : 'bg-deck-accent text-white shadow-lg shadow-deck-accent/20'
          }`}
      >
        {isStreamActive ? <RadioTower size={18} className="animate-pulse" /> : isJoinable ? <RadioTower size={18} /> : <Radio size={18} />}
        {isStreamActive ? 'Stop Stream' : isJoinable ? 'Join Stream' : 'Listen Live'}
      </button>

      {!player && (
        <div className="flex items-center gap-2 text-deck-dim/50 text-xs">
          <Play size={12} />
          Waiting for media…
        </div>
      )}
    </div>
  );
}
