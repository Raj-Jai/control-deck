import { useRef, useState, useCallback } from 'react';
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

  const clampedIdx = players.length === 0 ? 0 : idx % players.length;

  const go = useCallback((i: number) => {
    if (players.length === 0) return;
    setIdx(((i % players.length) + players.length) % players.length);
  }, [players.length]);

  const isSlider = (el: EventTarget | null) =>
    el instanceof HTMLElement && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'range';

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSlider(e.target)) return;
    touchStart.current = e.touches[0].clientX;
    setDragging(true);
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!dragging || isSlider(e.target)) return;
    setDragging(false);
    const dx = e.changedTouches[0].clientX - touchStart.current;
    if (dx > SWIPE_THRESHOLD) go(clampedIdx - 1);
    else if (dx < -SWIPE_THRESHOLD) go(clampedIdx + 1);
  }, [dragging, clampedIdx, go]);

  if (players.length === 0) {
    return <NowPlayingCard player={null} state={state ?? null} />;
  }

  return (
    <div
      className="relative"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {players.length > 1 && (
        <>
          <button
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
            onClick={() => go(clampedIdx - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
            onClick={() => go(clampedIdx + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </>
      )}

      <NowPlayingCard player={players[clampedIdx]} state={state ?? null} />

      {players.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-2">
          {players.map((p, i) => (
            <button
              key={p.id}
              className="p-2 -my-2 flex items-center justify-center"
              onClick={() => setIdx(i)}
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
