import { useEffect, useState } from 'react';
import { Radio, Clock, AlertTriangle } from 'lucide-react';
import {
  freshnessFrom, freshnessLabel, freshnessExplanation,
  type Freshness, type FreshnessState,
} from '../lib/freshness';
import { STREAM_INTERVAL_MS } from '../hooks/useMediaStream';

/**
 * Says how current the rest of the deck is.
 *
 * There was nothing like this anywhere, so a value that arrived before a
 * seventeen-second stall looked exactly as authoritative as one from a moment
 * ago (UX-29). It is deliberately quiet when live and loud when not: the point
 * is that a stale reading should not be mistaken for a current one.
 */
export default function FreshnessPill({
  lastUpdateAt,
  intervalMs = STREAM_INTERVAL_MS,
}: {
  lastUpdateAt: number | null;
  intervalMs?: number;
}) {
  const [state, setState] = useState<FreshnessState>(() =>
    freshnessFrom(lastUpdateAt, Date.now(), intervalMs)
  );

  // Re-evaluate on a timer so an otherwise idle deck still goes stale.
  useEffect(() => {
    const update = () => setState(freshnessFrom(lastUpdateAt, Date.now(), intervalMs));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [lastUpdateAt, intervalMs]);

  const tone: Record<Freshness, string> = {
    live: 'text-deck-muted',
    ageing: 'text-deck-warning',
    stale: 'text-deck-danger',
    lost: 'text-deck-danger',
  };
  const Icon = state.status === 'live' ? Radio : state.status === 'ageing' ? Clock : AlertTriangle;

  return (
    <span
      // Polite: a change here is worth announcing but not worth interrupting.
      role="status"
      aria-live="polite"
      title={freshnessExplanation(state)}
      className={`inline-flex items-center gap-1.5 text-[10px] ${tone[state.status]}`}
    >
      <Icon size={11} className={state.status === 'live' ? '' : 'animate-pulse'} aria-hidden="true" />
      {freshnessLabel(state)}
      <span className="sr-only">. {freshnessExplanation(state)}</span>
    </span>
  );
}
