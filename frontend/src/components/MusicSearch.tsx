import { useState, useEffect, useRef } from 'react';
import { Search, Play, Loader2, Music2, X } from 'lucide-react';
import type { MusicSearchResult } from '../services/apiService';
import { searchMusic, playMusic } from '../services/apiService';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface MusicSearchProps {
  available: boolean;
}

export default function MusicSearch({ available }: MusicSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MusicSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  // Monotonic request id: only the newest search may write to state.
  const requestSeq = useRef(0);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    // Bump the sequence even for a short query, so an in-flight response for a
    // longer one cannot land after the user cleared the box.
    ++requestSeq.current;
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const issued = ++requestSeq.current;
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await searchMusic(q, 8);
        // A slow response for an earlier query must not overwrite the results
        // for the one the user is actually looking at (BUG-030).
        if (requestSeq.current !== issued) return;
        setResults(res);
        setError(null);
      } catch (e) {
        if (requestSeq.current !== issued) return;
        setError(e instanceof Error ? e.message : 'Search failed');
        setResults([]);
      } finally {
        if (requestSeq.current === issued) setLoading(false);
      }
    }, 450);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  async function handlePlay(r: MusicSearchResult) {
    setPlayingId(r.id);
    try {
      await playMusic(r.url, r.title, r.artist);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Play failed');
    } finally {
      setPlayingId(null);
    }
  }

  if (!available) {
    return (
      <div className="text-xs text-deck-muted/70 text-center py-2 px-3">
        Song search requires <span className="text-deck-accent">yt-dlp</span> and{' '}
        <span className="text-deck-accent">mpv</span> on the host.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-deck-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs on YouTube…"
          className="w-full pl-9 pr-8 py-2 rounded-xl bg-white/[0.06] border border-white/[0.1] text-sm text-deck-text placeholder:text-deck-muted/60 focus:outline-none focus:border-deck-accent/40 transition-colors"
        />
        {loading && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-deck-muted animate-spin" />
        )}
        {!loading && query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-deck-muted hover:text-deck-text cursor-pointer p-0.5"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-400 px-1">{error}</div>}

      {results.length > 0 && (
        <ul className="flex flex-col gap-1 max-h-[280px] overflow-y-auto pr-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => handlePlay(r)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-transparent hover:border-white/[0.08] transition-all cursor-pointer text-left"
              >
                <div className="w-11 h-11 flex-shrink-0 rounded-md overflow-hidden bg-deck-muted/10 flex items-center justify-center">
                  {r.thumbnail ? (
                    <img src={r.thumbnail} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <Music2 size={18} className="text-deck-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-deck-text truncate font-medium">{r.title}</div>
                  <div className="text-xs text-deck-muted truncate">
                    {r.artist || 'Unknown artist'}
                    {r.duration > 0 && <span> · {formatTime(r.duration)}</span>}
                  </div>
                </div>
                <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-deck-accent/15 text-deck-accent">
                  {playingId === r.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
