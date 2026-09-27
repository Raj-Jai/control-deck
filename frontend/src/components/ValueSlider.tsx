import { useCallback, useEffect, useRef, useState } from 'react';

export interface ValueSliderProps {
  /** What the host last reported, in the same units as `onCommit`. */
  hostValue: number | null;
  /** Slider position to show, 0-100. */
  value: number;
  label: string;
  disabled?: boolean;
  /** Convert a 0-100 slider position into the value to send. */
  toValue: (percent: number) => number;
  /** Called at most every `throttleMs` while dragging, and once on release. */
  onSend: (value: number) => void | Promise<boolean>;
  /** Format the value for the readout. */
  format?: (value: number) => string;
  throttleMs?: number;
  className?: string;
  id?: string;
}

/**
 * A slider that sends while you drag and reverts when the host refuses.
 *
 * Three places in the app had this, each a slightly different copy, and the
 * copies had drifted: one of them cleared its dragging flag on pointerup but
 * not on keyup, so a keyboard user left it stuck showing a local value instead
 * of the host's; and the responses were thrown away, so a rejected change left
 * the handle where the user dragged it while the player never moved. One
 * component, one behaviour.
 *
 * ## The gesture lifecycle, which is the whole trick
 *
 * Two rules, and the slider is smooth:
 *
 * 1. The host must not overwrite the handle while a gesture is in flight, and
 *    for a moment after one ends. The host echoes state asynchronously, so the
 *    reading that arrives right after a commit is usually the *pre-drag* one.
 *    While `dragging` is true, or while a commit is still settling, the host's
 *    value is ignored. Releasing `dragging` before the send resolved was what
 *    made the handle snap back to the old value on every touch drag.
 *
 * 2. Only Pointer Events end a gesture. Touch browsers also fire `touchend`
 *    and a synthesised `mouseup` for the same physical release, so a handler on
 *    each of them ran the commit three or four times per tap. `pointerup` and
 *    `pointercancel` cover touch, pen and mouse in one path, and the keyboard
 *    is handled separately.
 *
 * ## The invariant for `pending`
 *
 * `pending.current` is always the raw slider position, 0-100, never a host
 * value. Conversion happens at send time, on every path, via `toValue`.
 * Storing a converted value here instead would double-convert the moment a
 * second call site was added, and the two send paths drifting apart is exactly
 * how the release ended up sending 44 where 0.44 was meant.
 */
export default function ValueSlider({
  hostValue,
  value,
  label,
  disabled,
  toValue,
  onSend,
  format,
  throttleMs = 80,
  className = '',
  id,
}: ValueSliderProps) {
  const [dragging, setDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [error, setError] = useState('');
  const lastSent = useRef(0);
  const pending = useRef<number | null>(null);
  // A commit is in flight, or has just landed and the host has not caught up.
  const settling = useRef<number | null>(null);
  const gesture = useRef(0);

  // While not dragging, and not settling, the host is the source of truth.
  useEffect(() => {
    if (dragging) return;
    if (settling.current !== null) {
      // Accept the host as soon as it agrees with what we sent. Anything else
      // in this window is the pre-drag value still making its way back.
      if (hostValue !== null && Math.abs(hostValue - settling.current) <= 1) {
        settling.current = null;
      } else {
        return;
      }
    }
    setLocalValue(value);
  }, [value, hostValue, dragging]);

  const commit = useCallback(async () => {
    const last = pending.current;
    pending.current = null;
    if (last === null) return;
    const mine = gesture.current;
    setDragging(false);
    // Ignore the pre-drag echo while the host catches up with the commit.
    const sent = toValue(last);
    settling.current = sent;
    const ok = await onSend(sent);
    // A newer gesture started while this one was awaiting.
    if (gesture.current !== mine) return;
    if (ok === false) {
      settling.current = null;
      // Put the handle back where the host says it is, and say why.
      if (hostValue !== null) setLocalValue(hostValue);
      setError(`The host rejected that ${label.toLowerCase()} change.`);
    } else {
      setError('');
    }
  }, [hostValue, label, onSend, toValue]);

  const endGesture = useCallback(() => {
    void commit();
  }, [commit]);

  const handleChange = (percent: number) => {
    setLocalValue(percent);
    setDragging(true);
    settling.current = null;
    pending.current = percent;
    const now = Date.now();
    if (now - lastSent.current < throttleMs) return;
    lastSent.current = now;
    // A throttled send is fire-and-forget; the commit at the end is the one
    // whose answer is acted on. It is only skipped while a commit is settling,
    // so a late throttle cannot land after the value the user actually chose.
    if (settling.current === null) void onSend(toValue(percent));
  };

  return (
    <div className={`flex flex-col min-w-0 ${className}`}>
      {/* The readout sits above the track rather than beside it. Inline, it took
          36px plus a 12px gap out of the cell, which on a 390px phone left the
          track 86px wide inside a 332px row - a 24px thumb on a stub. */}
      <div className="flex justify-end mb-0.5">
        <span
          className="text-[11px] text-deck-dim tabular-nums"
          role="status"
          aria-live="polite"
        >
          {format ? format(localValue) : `${Math.round(localValue)}%`}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={localValue}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => handleChange(Number(e.target.value))}
        onPointerDown={() => {
          gesture.current += 1;
          setDragging(true);
        }}
        // pointerup and pointercancel cover touch, pen and mouse. A touch
        // browser also fires touchend and a synthesised mouseup for the same
        // release, so those are deliberately not bound here.
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        // The keyboard ends a gesture too; without this a keyboard user's
        // slider never released (BUG-005).
        onKeyUp={endGesture}
        onBlur={endGesture}
        className="w-full"
      />
      {error && (
        <span role="alert" className="text-[10px] text-deck-danger mt-1 leading-snug">
          {error}
        </span>
      )}
    </div>
  );
}
