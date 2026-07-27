import { useEffect, useState } from 'react';
import { Monitor, Radio, RadioTower, VolumeX, Cast } from 'lucide-react';

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
  sync_broadcast: boolean;
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

export default function ConnectedDevicesCard() {
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

  const thisDeviceId = sessionStorage.getItem('dash_device_id') || '';

  const [ctrlErr, setCtrlErr] = useState('');
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

  const toggleSyncBroadcast = async () => {
    setCtrlErr('');
    const action = data?.sync_broadcast ? 'stop' : 'start';
    try {
      const res = await fetch('/api/stream/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, sync: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        setCtrlErr(`sync ${action} failed: ${res.status} ${text}`);
      }
    } catch (e) {
      setCtrlErr(`network error: ${e}`);
    }
  };

  if (!data || data.clients.length === 0) {
    if (ctrlErr) return <div className="deck-card"><p className="text-[10px] text-red-400">{ctrlErr}</p></div>;
    return null;
  }

  return (
    <div className="deck-card flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Monitor size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Connected Devices
        </span>
        <span className="text-[10px] text-deck-muted/40 font-medium">{data.count}</span>
        <button
          onClick={toggleSyncBroadcast}
          className={`icon-btn w-7 h-7 flex-shrink-0 ${
            data.sync_broadcast
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : ''
          }`}
          title={data.sync_broadcast ? 'Stop sync broadcast' : 'Sync broadcast (keep laptop audio)'}
        >
          {data.sync_broadcast
            ? <Cast size={12} className="animate-pulse" />
            : <Cast size={12} />
          }
        </button>
        <button
          onClick={toggleBroadcast}
          className={`icon-btn w-7 h-7 flex-shrink-0 ${
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
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className="flex flex-col gap-1.5">
        {data.clients.map((c, i) => {
          const isThis = c.device_id === thisDeviceId;
          return (
            <div key={c.device_id || i}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${
                isThis ? 'bg-deck-accent/8 border border-deck-accent/15' : 'bg-white/[0.03]'
              }`}
            >
              <span className="text-base leading-none flex-shrink-0">{deviceIcon(c)}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-deck-text truncate">
                  {deviceLabel(c)}
                  {isThis && <span className="text-deck-muted/40 ml-1">(you)</span>}
                </div>
              </div>
              <button
                className={`icon-btn w-7 h-7 flex-shrink-0 ${
                  c.streaming
                    ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
                    : ''
                }`}
                onClick={() => control(c.device_id, c.streaming ? 'stop' : 'start')}
                title={c.streaming ? 'Stop stream' : 'Start stream'}
              >
                {c.streaming
                  ? <RadioTower size={12} className="animate-pulse" />
                  : <Radio size={12} />
                }
              </button>
            </div>
          );
        })}
      </div>
      {ctrlErr && <p className="text-[10px] text-red-400 mt-1">{ctrlErr}</p>}
    </div>
  );
}