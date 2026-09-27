import { useEffect, useState } from 'react';
import { Radio, RadioTower, Loader2, AlertTriangle, Hand } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import * as streamManager from '../lib/streamManager';
import type { StreamInfo, StreamStatus } from '../lib/streamManager';

interface Props {
  state: MediaState | null;
  compact?: boolean;
}

/** Short label for the non-compact tile. */
function labelFor(status: StreamStatus, joinable: boolean): string {
  switch (status) {
    case 'connecting':
      return 'Connecting';
    case 'reconnecting':
      return 'Retrying';
    case 'gesture-needed':
      return 'Tap';
    case 'error':
      return 'Error';
    case 'playing':
      return 'Stop';
    default:
      return joinable ? 'Listen' : 'Stream';
  }
}

function iconFor(status: StreamStatus) {
  if (status === 'connecting' || status === 'reconnecting') return Loader2;
  if (status === 'error') return AlertTriangle;
  if (status === 'gesture-needed') return Hand;
  if (status === 'playing') return RadioTower;
  return Radio;
}

export default function AudioStreamCard({ state, compact }: Props) {
  const [info, setInfo] = useState<StreamInfo>({ status: 'idle', latencyMs: 0, driftMs: 0, gaps: 0, drops: 0, outputLatencyMs: 0, error: null });
  // True when the host reports an audio pipeline running for some *other*
  // device. This device is not streaming, so the action is to join, not stop.
  const [joinable, setJoinable] = useState(false);

  useEffect(() => streamManager.subscribe(setInfo), []);

  // The host stream flag is a global, not a per-device one: it means audio is
  // being captured for somebody. Track it separately from our own status so
  // the button offers "Listen" instead of implying we are already playing.
  useEffect(() => {
    if (!state) return;
    setJoinable(!!state.audio_stream_active);
  }, [state?.audio_stream_active]);

  const status = info.status;
  const isPlaying = status === 'playing';
  const isBusy = status === 'connecting' || status === 'reconnecting';

  // Stop only stops *our* stream. When the host is broadcasting to other
  // devices and we are not connected, the action is to join, not to stop.
  const handleToggle = () => {
    if (status === 'gesture-needed') {
      // This control is the most obvious place to tap, so let it resume the
      // context rather than requiring the tap to land somewhere else.
      streamManager.unlock();
      return;
    }
    if (isPlaying) streamManager.stop();
    else streamManager.start();
  };

  const label = labelFor(status, joinable);
  const Icon = iconFor(status);

  const tone =
    status === 'error'
      ? 'bg-red-500/15 border-red-500/30 text-red-400'
      : status === 'gesture-needed'
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
      : isPlaying
      ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
      : isBusy
      ? 'text-deck-dim'
      : joinable
      ? 'text-cyan-300'
      : '';

  if (compact) {
    return (
      <button
        className={`media-btn relative ${tone}`}
        onClick={handleToggle}
        title={info.error ? `Stream audio — ${info.error}` : label}
        aria-label={info.error ? `Stream audio: ${info.error}` : label}
      >
        <span className={isBusy ? 'animate-spin' : isPlaying ? 'animate-pulse' : ''}>
          <Icon size={16} />
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      // Native button rather than a div with role="button": keyboard
      // activation, focus ring and pressed state come from the platform.
      <button
        type="button"
        className={`toggle-card w-full ${tone} ${isPlaying ? 'active' : ''}`}
        onClick={handleToggle}
        aria-pressed={isPlaying}
        aria-label={label}
      >
        <span className={`text-[28px] leading-none ${isBusy ? 'animate-spin' : isPlaying ? 'animate-pulse' : ''}`}>
          <Icon size={28} />
        </span>
        <span className="toggle-label text-xs font-semibold text-center leading-tight">
          {label}
        </span>
      </button>

      {isPlaying && (
        <div className="text-[10px] text-deck-dim text-center leading-tight" role="status">
          <div>
            latency {info.latencyMs}ms
            {info.outputLatencyMs > 5 ? ` · out ${info.outputLatencyMs}ms` : ''}
          </div>
          <div className="text-deck-muted/50">
            drift {info.driftMs >= 0 ? '+' : ''}
            {info.driftMs}ms
            {info.gaps > 0 ? ` · ${info.gaps} gap${info.gaps > 1 ? 's' : ''}` : ''}
            {info.drops > 0 ? ` · ${info.drops} drop${info.drops > 1 ? 's' : ''}` : ''}
          </div>
        </div>
      )}

      {status === 'gesture-needed' && (
        <p className="text-[10px] text-amber-300/90 text-center leading-tight">
          Browser blocked autoplay — tap anywhere to enable audio.
        </p>
      )}

      {status === 'error' && info.error && (
        <p className="text-[10px] text-red-400/90 text-center leading-tight break-words">
          {info.error}
        </p>
      )}
    </div>
  );
}
