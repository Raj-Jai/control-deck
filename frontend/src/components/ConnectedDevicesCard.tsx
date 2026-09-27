import { useEffect, useState } from 'react';
import { Monitor, Radio, RadioTower, VolumeX } from 'lucide-react';

interface ClientInfo {
  ip: string;
  ua: string;
  connected: string;
  last_seen: string;
  path: string;
  device_id: string;
  streaming: boolean;
}

interface ClientsResponse {
  count: number;
  clients: ClientInfo[];
  broadcasting: boolean;
}

function deviceLabel(c: ClientInfo): string {
  const ua = c.ua;
  if (/iPad|iPhone|iPod/.test(ua)) return 'iPad/iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS/.test(ua)) return 'macOS';
  return c.ip;
}

function deviceIcon(c: ClientInfo): string {
  const ua = c.ua;
  if (/iPad/.test(ua)) return '📟';
  if (/iPhone/.test(ua)) return '📱';
  if (/Android/.test(ua)) return '📱';
  if (/CrOS/.test(ua) || /Linux/.test(ua)) return '💻';
  if (/Windows/.test(ua)) return '🖥️';
  if (/Mac OS/.test(ua)) return '🍎';
  return '📡';
}

/**
 * When readOnly, the card is a list and nothing more.
 *
 * The Media Streamer mode is unlocked with a separate, weaker PIN and is
 * described as "just listen to what is playing", but it rendered this card
 * whole - including the broadcast toggle, which mutes the workstation and
 * pushes audio to every connected device, and the per-device start and stop. A
 * guest could therefore do something materially different from listening
 * (SEC-010). The mode now passes readOnly and sees only the list, and says so.
 */
export default function ConnectedDevicesCard({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [data, setData] = useState<ClientsResponse | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const id = sessionStorage.getItem('dash_device_id') || '';
        const res = await fetch(`/api/clients?device_id=${encodeURIComponent(id)}`);
        setData(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  // Fallback for a missed SSE stream_command (buffered-channel race, or the
  // hotkey pressed before this client's EventSource was ready).
  //
  // Only ever drives *auto-joined* streams. If the user started or stopped the
  // stream from this device, the poll must not override that — otherwise a
  // manual Stream is torn down within 2 s when the broadcast flag flips, and a
  // manual Stop is silently undone by the next poll that sees broadcasting.
  useEffect(() => {
    if (!data) return;
    import('../lib/streamManager').then(m => {
      if (m.isUserDriven()) return;
      if (data.broadcasting && !m.isActive()) {
        m.start('auto');
      } else if (!data.broadcasting && m.isActive()) {
        m.stop('auto');
      }
    });
  }, [data?.broadcasting]);

  const thisDeviceId = sessionStorage.getItem('dash_device_id') || '';

  const [ping, setPing] = useState<number | null>(null);

  useEffect(() => {
    const measure = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/ping', { method: 'HEAD', cache: 'no-store' });
        setPing(Math.round(performance.now() - t0));
      } catch { setPing(null); }
    };
    // Five measurements a second, forever, including while the tab is hidden -
    // unlike every other poll in the app. A backgrounded dashboard kept
    // measuring latency to the host and waking the radio for it.
    if (document.hidden) return;
    measure();
    const id = setInterval(() => { if (!document.hidden) measure(); }, 200);
    const onVisible = () => { if (!document.hidden) measure(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const [ctrlErr, setCtrlErr] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  useEffect(() => {
    const onNeed = () => setNeedsTap(true);
    const onUnlock = () => setNeedsTap(false);
    window.addEventListener('audio-needs-gesture' as any, onNeed);
    window.addEventListener('audio-unlocked' as any, onUnlock);
    // Also clear prompt when broadcast stops
    return () => {
      window.removeEventListener('audio-needs-gesture' as any, onNeed);
      window.removeEventListener('audio-unlocked' as any, onUnlock);
    };
  }, []);
  // Hide prompt when broadcast stops
  useEffect(() => {
    if (data && !data.broadcasting) setNeedsTap(false);
  }, [data?.broadcasting]);
  const control = async (target: string, action: 'start' | 'stop') => {
    setCtrlErr('');
    try {
      const res = await fetch('/api/stream/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, action }),
      });
      if (!res.ok) {
        const text = await res.text();
        setCtrlErr(`${action} failed: ${res.status} ${text}`);
      }
    } catch (e) {
      setCtrlErr(`network error: ${e}`);
    }
  };

  const toggleBroadcast = async () => {
    setCtrlErr('');
    const action = data?.broadcasting ? 'stop' : 'start';
    try {
      const res = await fetch('/api/stream/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const text = await res.text();
        setCtrlErr(`broadcast ${action} failed: ${res.status} ${text}`);
      }
    } catch (e) {
      setCtrlErr(`network error: ${e}`);
    }
  };

  const header = (
    <div className="flex items-center gap-2.5">
      <Monitor size={16} className="text-deck-accent" />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
        Connected Devices
      </span>
      <span className="text-[10px] text-deck-dim font-medium">{data?.count ?? 0}</span>
    </div>
  );

  // The card used to return null with no clients, so it silently disappeared:
  // a backend failure looked identical to "nothing is connected", and the
  // column below it jumped. Always render the frame and name the state.
  if (!data || data.clients.length === 0) {
    return (
      <div className="deck-card flex flex-col gap-2.5" role="status">
        {header}
        <p className={`text-[11px] ${ctrlErr ? 'text-deck-danger' : 'text-deck-muted/60'}`}>
          {ctrlErr || 'No other devices connected'}
        </p>
      </div>
    );
  }

  return (
    <div className="deck-card flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Monitor size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Connected Devices
        </span>
        <span className="text-[10px] text-deck-dim font-medium">{data.count}</span>
        {!readOnly && (
        <button
          onClick={toggleBroadcast}
          aria-label={data.broadcasting ? 'Stop broadcast' : 'Broadcast to all devices'}
          className={`icon-btn min-h-[44px] min-w-[44px] flex-shrink-0 ${
            data.broadcasting
              ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
              : ''
          }`}
          title={data.broadcasting ? 'Stop broadcast & unmute' : 'Mute & broadcast to all'}
        >
          {data.broadcasting
            ? <RadioTower size={12} className="animate-pulse" />
            : <VolumeX size={12} />
          }
        </button>
        )}
        <div className="flex-1 h-px bg-deck-surface-2" />
      </div>
      {needsTap && data.broadcasting && (
        <div className="px-2 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-[11px] text-yellow-300 flex items-center gap-1.5">
          <span>🔊</span> Tap anywhere to enable audio — browser blocked autoplay
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {data.clients.map((c, i) => {
          const isThis = c.device_id === thisDeviceId;
          return (
            <div key={c.device_id || i}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                isThis ? 'bg-deck-accent/8 border border-deck-accent/15' : 'bg-deck-surface-2'
              }`}
            >
              <span className="text-base leading-none flex-shrink-0">{deviceIcon(c)}</span>
              <div className="min-w-0 flex-1">
                  <div className="font-medium text-deck-text truncate">
                    {deviceLabel(c)}
                    {isThis && <span className="text-deck-dim ml-1">(you)</span>}
                  </div>
                  {isThis && ping !== null && (
                    <div className="text-[10px] text-deck-dim mt-0.5 flex items-center gap-1">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        ping < 10 ? 'bg-green-400' : ping < 50 ? 'bg-yellow-400' : 'bg-red-400'
                      }`} />
                      {ping}ms
                    </div>
                  )}
                </div>
              {!readOnly && (
              <button
                className={`icon-btn min-h-[44px] min-w-[44px] flex-shrink-0 ${
                  c.streaming
                    ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
                    : ''
                }`}
                onClick={() => control(c.device_id, c.streaming ? 'stop' : 'start')}
                title={c.streaming ? 'Stop stream' : 'Start stream'}
                aria-label={`${c.streaming ? 'Stop stream to' : 'Start stream to'} ${deviceLabel(c)}`}
              >
                {c.streaming
                  ? <RadioTower size={12} className="animate-pulse" />
                  : <Radio size={12} />
                }
              </button>
              )}
            </div>
          );
        })}
      </div>
      {readOnly && data.count > 0 && (
        <p className="text-[10px] text-deck-muted/60">
          Listening only — stream controls need the dashboard PIN.
        </p>
      )}
      {ctrlErr && <p className="text-[10px] text-deck-danger mt-1">{ctrlErr}</p>}
    </div>
  );
}