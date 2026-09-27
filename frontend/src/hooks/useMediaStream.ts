import { useEffect, useState } from 'react';
import { applyFrame, emptyAccumulator, isDeltaMessage } from '../lib/sseDelta';
import { DECK_CONFIG } from '../config/deckConfig';

export interface SystemStats {
  cpu: number;
  ram: number;
  ram_used: number;
  ram_total: number;
  battery: number;
  charging: boolean;
  temp: number;
  ssid: string;
  ip: string;
  ping_ok: boolean;
  gpu?: {
    present: boolean;
    name?: string;
    util: number;
    mem_used: number;
    mem_total: number;
    temp: number;
  };
}

export interface AppStreamInfo {
  id: number;
  app: string;
  media_name: string;
  volume: number;
  muted: boolean;
}

export interface SinkInfo {
  id: number;
  name: string;
  description: string;
  default: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  title: string | null;
  artist: string | null;
  status: string | null;
  art_url: string | null;
  position: number;
  length: number;
}

export interface LyricVersion {
  lang: string;
  plain_lyrics: string;
  synced_lyrics: string;
  instrumental: boolean;
}

export interface LyricData {
  track_id: string;
  instrumental: boolean;
  plain_lyrics: string;
  synced_lyrics: string;
  versions?: LyricVersion[];
}

export interface CmdLogEntry {
  time: string;
  command: string;
}

export interface MediaState {
  title: string | null;
  artist: string | null;
  status: string | null;
  art_url: string | null;
  position: number;
  length: number;
  volume: number;
  muted: boolean;
  brightness: number;
  night_light: boolean;
  caffeine_on: boolean;
  caffeine_custom: boolean;
  caffeine_duration: number;
  bluetooth_on: boolean;
  bt_sink_on: boolean;
  warp_on: boolean;
  audio_stream_active: boolean;
  lyrics: LyricData | null;
  players: PlayerState[];
  sinks: SinkInfo[];
  app_streams: AppStreamInfo[];
  sys: SystemStats | null;
  cmd_log: CmdLogEntry[];
}

interface UseMediaStreamResult {
  state: MediaState | null;
  loading: boolean;
  error: string | null;
  /** When the last frame arrived, so the UI can say how current the values are. */
  lastUpdateAt: number | null;
}

/** The broadcaster pushes twice a second; a few frames of slack is normal. */
export const STREAM_INTERVAL_MS = 500;

export function useMediaStream(deviceId?: string, enabled = true): UseMediaStreamResult {
  const [state, setState] = useState<MediaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);

  useEffect(() => {
    // Nothing connects while the page is locked.
    if (!enabled) {
      setLoading(true);
      return;
    }
    // Nothing has arrived yet, so nothing on screen is current.
    setLastUpdateAt(null);
    const streamUrl = DECK_CONFIG.api.stream + (deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '');
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let failures = 0;

    // Bounded exponential backoff with jitter so N clients don't hammer
    // the backend in lockstep after an outage. Resets on first good frame.
    const reconnectDelay = () => {
      const capped = Math.min(30000, 1000 * 2 ** Math.min(failures, 5));
      return capped + Math.random() * 500;
    };

    // Unchanged parts of the state now arrive as deltas, so the client
    // reassembles them onto the previous frame. A delta that does not line up
    // is dropped and the next full frame rebuilds the base.
    const acc = emptyAccumulator();

    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'stream_command') {
          // Host-driven, not a local user action: mark it as an auto-join so
          // a stream the user started by hand is not later overridden.
          if (data.action === 'start') {
            import('../lib/streamManager').then(m => m.start('auto'));
          } else if (data.action === 'stop') {
            import('../lib/streamManager').then(m => m.stop('auto'));
          }
          return;
        }

        const next = applyFrame(acc, data);
        if (next === null) {
          // Either a malformed message or a delta we could not line up. Nothing
          // is applied, and the next full frame will set us right.
          if (isDeltaMessage(data)) { acc.state = null; acc.baseIsFullFrame = true; }
          return;
        }
        acc.state = next;
        if (isDeltaMessage(data)) {
          acc.ordinal = data.o;
          acc.baseIsFullFrame = false;
        } else {
          acc.baseIsFullFrame = true;
        }

        failures = 0;
        setState(next as unknown as MediaState);
        setLastUpdateAt(Date.now());
        setLoading(false);
        setError(null);
      } catch {
        // skip malformed frames
      }
    };

    const connect = () => {
      if (cancelled) return;
      es?.close();
      es = new EventSource(streamUrl);
      es.onmessage = handleMessage;
      // Deltas arrive under their own event name so a client that does not
      // know about them simply never sees them.
      es.addEventListener('delta', handleMessage as EventListener);
      es.onerror = () => {
        if (cancelled) return;
        failures += 1;
        setError('Connection lost');
        setLoading(false);
        es?.close();
        reconnectTimer = setTimeout(connect, reconnectDelay());
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [deviceId, enabled]);

  return { state, loading, error, lastUpdateAt };
}
