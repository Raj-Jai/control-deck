import { useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PlayerState } from '../hooks/useMediaStream';
import NowPlayingCard from './NowPlayingCard';

interface PlayerCarouselProps {
  players: PlayerState[];
}

const SWIPE_THRESHOLD = 50;

export default function PlayerCarousel({ players }: PlayerCarouselProps) {
  const [idx, setIdx] = useState(0);
  const touchStart = useRef(0);
  const [dragging, setDragging] = useState(false);

  const clampedIdx = players.length === 0 ? 0 : idx % players.length;

  const go = useCallback((i: number) => {
    if (players.length === 0) return;
    setIdx(((i % players.length) + players.length) % players.length);
  }, [players.length]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = e.touches[0].clientX;
    setDragging(true);
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!dragging) return;
    setDragging(false);
    const dx = e.changedTouches[0].clientX - touchStart.current;
    if (dx > SWIPE_THRESHOLD) go(clampedIdx - 1);
    else if (dx < -SWIPE_THRESHOLD) go(clampedIdx + 1);
  }, [dragging, clampedIdx, go]);

  if (players.length === 0) {
    return <NowPlayingCard player={null} />;
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
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
            onClick={() => go(clampedIdx - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/30 text-white/70 hover:bg-black/50 hover:text-white"
            onClick={() => go(clampedIdx + 1)}
          >
            <ChevronRight size={14} />
          </button>
        </>
      )}

      <NowPlayingCard player={players[clampedIdx]} />

      {players.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-2">
          {players.map((p, i) => (
            <button
              key={p.id}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === clampedIdx ? 'bg-deck-accent' : 'bg-deck-dim/30'
              }`}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
