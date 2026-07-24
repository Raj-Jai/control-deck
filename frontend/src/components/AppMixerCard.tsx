import { useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Music } from 'lucide-react';
import type { AppStreamInfo } from '../hooks/useMediaStream';

const THROTTLE = 80;

export default function AppMixerCard({ streams }: { streams: AppStreamInfo[] }) {
  const [localVol, setLocalVol] = useState<Record<number, number>>({});
  const dragging = useRef<Record<number, boolean>>({});
  const lastSend = useRef<Record<number, number>>({});
  const [dirty, setDirty] = useState(0);

  const setStream = useCallback(async (id: number, body: Record<string, unknown>) => {
    try {
      await fetch('/api/audio/set-app-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
    } catch {}
  }, []);

  if (!streams || streams.length === 0) return null;

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2 mb-2">
        <Music size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          App Audio
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {streams.map((s) => {
          const vol = dragging.current[s.id]
            ? (localVol[s.id] ?? s.volume)
            : s.volume;

          return (
            <div key={s.id} className="deck-card !p-2 !bg-white/[0.03]">
              <div className="flex items-center justify-between mb-1">
                <div className="min-w-0 mr-2 flex-1">
                  <span className="text-xs font-medium text-deck-text truncate block">
                    {s.app || 'Unknown'}
                  </span>
                  {s.media_name && s.media_name !== s.app ? (
                    <span className="text-[10px] text-deck-dim truncate block">
                      {s.media_name}
                    </span>
                  ) : (
                    <span className="text-[10px] text-deck-dim/50 truncate block">
                      stream #{s.id}
                    </span>
                  )}
                </div>
                <button
                  className={`icon-btn w-6 h-6 flex-shrink-0 ${
                    s.muted ? 'bg-red-500/15 border-red-500/20 text-red-400' : 'text-deck-text'
                  }`}
                  onClick={() => setStream(s.id, { muted: !s.muted })}
                >
                  {s.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={vol}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setLocalVol(p => ({ ...p, [s.id]: v }));
                    dragging.current[s.id] = true;
                    const now = Date.now();
                    if (now - (lastSend.current[s.id] ?? 0) >= THROTTLE) {
                      lastSend.current[s.id] = now;
                      setStream(s.id, { volume: v });
                    }
                    setDirty(n => n + 1);
                  }}
                  onMouseUp={() => {
                    dragging.current[s.id] = false;
                    setStream(s.id, { volume: localVol[s.id] ?? s.volume });
                  }}
                  onTouchEnd={() => {
                    dragging.current[s.id] = false;
                    setStream(s.id, { volume: localVol[s.id] ?? s.volume });
                  }}
                  className="flex-1 min-w-0"
                />
                <span className="text-xs font-bold w-[30px] text-right text-deck-text flex-shrink-0">
                  {vol}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
