import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MediaState, PlayerState } from '../hooks/useMediaStream';
import NowPlayingCard from './NowPlayingCard';

interface PlayerCarouselProps {
  players: PlayerState[];
  state?: MediaState | null;
}

const SWIPE_THRESHOLD = 50;

export default function PlayerCarousel({ players, state }: PlayerCarouselProps) {
  const [idx, setIdx] = useState(0);
  const touchStart = useRef(0);
  const [dragging, setDragging] = useState(false);
  const lastFocusedPlaying = useRef<string | null>(null);

  const clampedIdx = players.length === 0 ? 0 : idx % players.length;

  // Auto-focus the currently playing player. Snaps to the player whose status
  // just became Playing (e.g. mpv when a song is started from the deck). Manual
  // swipes still work because we only re-snap when the playing player id
  // changes, not on every state poll.
  useEffect(() => {
    const playingIdx = players.findIndex(p => p.status === 'Playing');
    const playingId = playingIdx >= 0 ? players[playingIdx].id : null;
    if (playingId && playingId !== lastFocusedPlaying.current) {
      lastFocusedPlaying.current = playingId;
      setIdx(playingIdx);
    }
    if (!playingId) lastFocusedPlaying.current = null;
  }, [players]);

  const go = useCallback((i: number) => {
    if (players.length === 0) return;
    setIdx(((i % players.length) + players.length) % players.length);
  }, [players.length]);

  const isSlider = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range';

  // A gesture that starts on a slider is the slider's business, not ours. The
  // old code returned early on touchend without clearing the dragging flag it
  // had already set, so the carousel stopped responding for the rest of the
  // session after one drag on the seek bar (BUG-006).
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSlider(e.target)) {
      setDragging(false);
      return;
    }
    touchStart.current = e.touches[0].clientX;
    setDragging(true);
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    // Always release the flag, whatever happens next.
    const wasDragging = dragging;
    setDragging(false);
    if (!wasDragging || isSlider(e.target)) return;
    const dx = e.changedTouches[0].clientX - touchStart.current;
    if (dx > SWIPE_THRESHOLD) go(clampedIdx - 1);
    else if (dx < -SWIPE_THRESHOLD) go(clampedIdx + 1);
  }, [dragging, clampedIdx, go]);

  // A cancelled touch (a system gesture took over) must also release it.
  const onTouchCancel = useCallback(() => { setDragging(false); }, []);

  if (players.length === 0) {
    return <NowPlayingCard player={null} state={state ?? null} />;
  }

  return (
    <div
      className="relative"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      {players.length > 1 && (
        <>
          {/* Inside the card and 44px: at left-0/-translate-x-2 they straddled
              the border, sat on the seek time labels, and were clipped by the
              viewport edge on a 360px phone. */}
          <button
            className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-11 h-11 flex items-center
              justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white"
            onClick={() => go(clampedIdx - 1)}
            aria-label="Previous player"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-11 h-11 flex items-center
              justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white"
            onClick={() => go(clampedIdx + 1)}
            aria-label="Next player"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}

      <NowPlayingCard player={players[clampedIdx]} state={state ?? null} />

      {players.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-2">
          {players.map((p, i) => (
            <button
              key={p.id}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              onClick={() => setIdx(i)}
              aria-label={`Show ${p.title || `player ${i + 1}`}`}
              aria-current={i === clampedIdx ? 'true' : undefined}
            >
              <span className={`w-1.5 h-1.5 rounded-full block transition-colors ${
                i === clampedIdx ? 'bg-deck-accent' : 'bg-deck-dim/30'
              }`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
