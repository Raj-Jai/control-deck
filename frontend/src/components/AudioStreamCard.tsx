import { useRef, useEffect, useState } from 'react';
import { Radio, RadioTower } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';

interface Props {
  state: MediaState | null;
}

export default function AudioStreamCard({ state }: Props) {
  const [local, setLocal] = useState<'idle' | 'playing' | 'active_elsewhere'>('idle');
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const aliveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const msRef = useRef<MediaSource | null>(null);
  const sbRef = useRef<SourceBuffer | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const drainingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    if (!state) return;
    setLocal(prev => {
      if (state.audio_stream_active && prev === 'idle') return 'active_elsewhere';
      if (!state.audio_stream_active && prev === 'active_elsewhere') return 'idle';
      return prev;
    });
  }, [state?.audio_stream_active]);

  const cleanup = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    queueRef.current = [];
    drainingRef.current = false;

    if (msRef.current && msRef.current.readyState === 'open') {
      try { msRef.current.endOfStream(); } catch {}
    }
    msRef.current = null;
    sbRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current.load();
      audioRef.current = null;
    }
  };

  const feed = () => {
    const sb = sbRef.current;
    if (!sb || drainingRef.current || sb.updating) return;
    const queue = queueRef.current;
    if (queue.length === 0) return;
    drainingRef.current = true;
    sb.appendBuffer(queue.shift()!);
  };

  const startStream = () => {
    cleanup();

    const ms = new MediaSource();
    msRef.current = ms;

    const audio = new Audio();
    audioRef.current = audio;
    audio.src = URL.createObjectURL(ms);
    audio.preload = 'auto';

    ms.onsourceopen = () => {
      if (!aliveRef.current) return;
      let sb: SourceBuffer;
      try {
        sb = ms.addSourceBuffer('audio/mpeg');
      } catch {
        setLocal('idle');
        cleanup();
        return;
      }
      sbRef.current = sb;

      sb.onupdateend = () => {
        drainingRef.current = false;
        if (!aliveRef.current) return;

        if (sb.buffered.length > 0) {
          const end = sb.buffered.end(sb.buffered.length - 1);
          const start = sb.buffered.start(0);
          if (end - start > 10) {
            try { sb.remove(0, end - 8); } catch {}
          }
        }

        feed();
      };

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/api/audio-stream/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (e) => {
        if (!aliveRef.current) return;
        queueRef.current.push(e.data as ArrayBuffer);
        feed();
      };

      ws.onclose = ws.onerror = () => {
        if (!aliveRef.current) return;
        if (ms.readyState === 'open') {
          try { ms.endOfStream(); } catch {}
        }
        setLocal('idle');
      };
    };

    audio.play().then(() => {
      if (aliveRef.current) setLocal('playing');
    }).catch(() => {
      if (!aliveRef.current) return;
      setLocal('idle');
      cleanup();
      retryTimer.current = setTimeout(() => { if (aliveRef.current) setLocal('idle'); }, 3000);
    });
  };

  const handleToggle = () => {
    if (local === 'playing' || local === 'active_elsewhere') {
      setLocal('idle');
      cleanup();
      return;
    }
    startStream();
  };

  const isActive = local === 'playing';
  const isJoinable = local === 'active_elsewhere';
  const label = isActive ? 'Stop' : isJoinable ? 'Join' : 'Stream';
  const Icon = (isActive || isJoinable) ? RadioTower : Radio;

  return (
    <div
      className={`toggle-card ${isActive ? 'active' : ''} ${isJoinable ? 'ring-1 ring-yellow-500/30' : ''}`}
      onClick={handleToggle}
    >
      <span className={`text-[28px] leading-none ${isActive ? 'animate-pulse' : ''}`}>
        <Icon size={28} />
      </span>
      <span className="toggle-label text-xs font-semibold text-center leading-tight">
        {label}
      </span>
    </div>
  );
}
