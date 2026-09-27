/**
 * Apply the server's delta frames.
 *
 * The host sends the state twice a second and almost all of it is identical
 * between two consecutive frames, so unchanged parts now go out as
 * `event: delta` messages carrying only what moved. A client that does not
 * understand them still works: the wire format is a superset of the old
 * full-frame one, and anything that is not a delta is applied as-is.
 *
 * A `null` in a patch means "this key is now absent" - it cannot be omission,
 * because omission is how a delta says "unchanged". A gap in the ordinals
 * discards the accumulated base and waits for the next full frame, so a client
 * that misses a delta heals instead of drifting.
 */
export interface DeltaMessage {
  o: number;
  p: Record<string, unknown | null>;
}

export function isDeltaMessage(value: unknown): value is DeltaMessage {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as DeltaMessage;
  return typeof d.o === 'number' && typeof d.p === 'object' && d.p !== null;
}

export interface DeltaAccumulator {
  /** The last ordinal applied, or 0 when there is no usable base. */
  ordinal: number;
  /** The reconstructed state, or null when a full frame is needed. */
  state: Record<string, unknown> | null;
  /**
   * Whether the current base came from a full frame.
   *
   * This matters. A full frame carries no ordinal, so after one the client
   * cannot know where the numbering stands. It is also the one point at which
   * it *cannot* have missed a delta, so the next delta is safe whatever its
   * number. After a delta, by contrast, contiguity is exactly what proves
   * nothing was lost.
   */
  baseIsFullFrame: boolean;
}

export function emptyAccumulator(): DeltaAccumulator {
  return { ordinal: 0, state: null, baseIsFullFrame: true };
}

/**
 * Fold one message into the accumulator and return the new state, or null if
 * the message was not usable and the caller should wait for a full frame.
 */
export function applyFrame(
  acc: DeltaAccumulator,
  message: unknown
): Record<string, unknown> | null {
  if (isDeltaMessage(message)) {
    // After a full frame the numbering is unknown but nothing can have been
    // missed, so any forward step is fine. After a delta, only the very next
    // ordinal is safe: anything else means one was dropped, and the base is no
    // longer trustworthy.
    const usable = acc.state !== null && (
      acc.baseIsFullFrame
        ? message.o > acc.ordinal
        : message.o === acc.ordinal + 1
    );
    if (!usable) {
      return null;
    }
    const next = { ...acc.state };
    for (const [key, value] of Object.entries(message.p)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    return next;
  }

  // A full frame: it replaces everything.
  if (typeof message === 'object' && message !== null) {
    return { ...(message as Record<string, unknown>) };
  }
  return null;
}
