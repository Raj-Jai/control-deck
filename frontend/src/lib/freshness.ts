/**
 * How stale the state on screen is.
 *
 * Every value in the deck used to look equally current. The stream can stall -
 * a lyrics lookup alone blocked the broadcaster for up to 18 s - and the client
 * also polls on a timer, so a number on screen and the truth diverge regularly
 * with nothing to say so. A stale reading that looks live is worse than an
 * obviously stale one.
 */
export type Freshness = 'live' | 'ageing' | 'stale' | 'lost';

export interface FreshnessState {
  status: Freshness;
  /** Whole seconds since the last frame, for the label. */
  seconds: number;
}

/**
 * What the state means right now.
 *
 * `live` is inside one expected frame; `ageing` is a few frames behind, which
 * on a two-frames-per-second stream is a moment; `stale` is well past that and
 * the numbers should not be trusted; `lost` means the stream has not spoken at
 * all for long enough that a reconnect is the honest description.
 */
export function freshnessFrom(
  lastUpdateAt: number | null,
  now: number,
  intervalMs: number
): FreshnessState {
  if (lastUpdateAt === null) {
    return { status: 'lost', seconds: 0 };
  }
  const elapsed = Math.max(0, now - lastUpdateAt);
  const frames = Math.max(1, intervalMs);
  const seconds = Math.floor(elapsed / 1000);

  if (elapsed <= frames * 3) return { status: 'live', seconds };
  if (elapsed <= frames * 10) return { status: 'ageing', seconds };
  return { status: 'stale', seconds };
}

const LABELS: Record<Freshness, (seconds: number) => string> = {
  live: () => 'Live',
  ageing: (s) => `${s}s ago`,
  stale: (s) => `Stale · ${s}s ago`,
  lost: () => 'Not updating',
};

export function freshnessLabel(state: FreshnessState): string {
  return LABELS[state.status](state.seconds);
}

/** A short reason, for a title attribute or a live region. */
export function freshnessExplanation(state: FreshnessState): string {
  switch (state.status) {
    case 'live':
      return 'The host is sending live state.';
    case 'ageing':
      return 'The host is a few seconds behind. The values on screen may lag reality.';
    case 'stale':
      return 'These values are out of date. The host has not sent anything recently.';
    case 'lost':
      return 'No state has arrived from the host. Nothing on screen is current.';
  }
}
