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

  // While not dragging, the host is the source of truth.
  useEffect(() => {
    if (!dragging) setLocalValue(value);
  }, [value, dragging]);

  const commit = useCallback(async () => {
    setDragging(false);
    const last = pending.current;
    pending.current = null;
    if (last === null) return;
    const ok = await onSend(last);
    if (ok === false) {
      // Put the handle back where the host says it is, and say why.
      if (hostValue !== null) setLocalValue(hostValue);
      setError(`The host rejected that ${label.toLowerCase()} change.`);
    } else {
      setError('');
    }
  }, [hostValue, label, onSend]);

  const handleChange = (percent: number) => {
    setLocalValue(percent);
    setDragging(true);
    pending.current = percent;
    const now = Date.now();
    if (now - lastSent.current < throttleMs) return;
    lastSent.current = now;
    // A throttled send is fire-and-forget; the commit at the end is the one
    // whose answer is acted on.
    void onSend(toValue(percent));
  };

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={localValue}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => handleChange(Number(e.target.value))}
        // Commit on every way a drag can end, including the keyboard. Clearing
        // the flag only on pointerup left a keyboard user's slider permanently
        // showing its own value instead of the host's.
        onPointerUp={commit}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="flex-1 min-w-0"
      />
      <span
        className="text-[11px] text-deck-dim w-9 text-right tabular-nums shrink-0"
        role="status"
        aria-live="polite"
      >
        {format ? format(localValue) : `${Math.round(localValue)}%`}
      </span>
      {error && (
        <span role="alert" className="text-[10px] text-deck-danger shrink-0 max-w-[40%]">
          {error}
        </span>
      )}
    </div>
  );
}
