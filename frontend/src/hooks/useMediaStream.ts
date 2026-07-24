import { useEffect, useState, useRef } from 'react';
import { DECK_CONFIG } from '../config/deckConfig';

export interface SystemStats {
  cpu: number;
  ram: number;
  battery: number;
  charging: boolean;
  temp: number;
  ssid: string;
  ip: string;
  ping_ok: boolean;
}

export interface SinkInfo {
  id: number;
  name: string;
  description: string;
  default: boolean;
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
  warp_on: boolean;
  audio_stream_active: boolean;
  sinks: SinkInfo[];
  sys: SystemStats | null;
}

interface UseMediaStreamResult {
  state: MediaState | null;
  loading: boolean;
  error: string | null;
}

export function useMediaStream(): UseMediaStreamResult {
  const [state, setState] = useState<MediaState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let es = new EventSource(DECK_CONFIG.api.stream);

    es.onmessage = (e) => {
      try {
        const data: MediaState = JSON.parse(e.data);
        setState(data);
        setLoading(false);
        setError(null);
      } catch {
        // skip malformed frames
      }
    };

    es.onerror = () => {
      setError('Connection lost');
      setLoading(false);
      es.close();
      // attempt reconnect after 3s
      const timer = setTimeout(() => {
        es = new EventSource(DECK_CONFIG.api.stream);
        es.onmessage = (ev) => {
          try {
            const data: MediaState = JSON.parse(ev.data);
            setState(data);
            setLoading(false);
            setError(null);
          } catch {
            // skip
          }
        };
      }, 3000);
      esRef.current = es;
      const cleanup = () => clearTimeout(timer);
      return cleanup;
    };

    esRef.current = es;

    return () => {
      es.close();
    };
  }, []);

  return { state, loading, error };
}
