import { useEffect, useState, useRef } from 'react';
import { Monitor, Radio, RadioTower, VolumeX, MapPin } from 'lucide-react';

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

const ROOM_LAT = 22.321917;
const ROOM_LNG = 87.303572;

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

  const [ping, setPing] = useState<number | null>(null);
  const pingRef = useRef<number[]>([]);

  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null);
  const [posErr, setPosErr] = useState('');

  useEffect(() => {
    if (!navigator.geolocation) { setPosErr('GPS unavailable'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => { if (e.code === e.PERMISSION_DENIED) setPosErr('GPS denied'); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  useEffect(() => {
    const measure = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/ping', { method: 'HEAD', cache: 'no-store' });
        const rtt = performance.now() - t0;
        pingRef.current = [...pingRef.current.slice(-9), rtt];
        const min = Math.min(...pingRef.current);
        setPing(Math.round(min));
      } catch { setPing(null); }
    };
    measure();
    const id = setInterval(measure, 3000);
    return () => clearInterval(id);
  }, []);

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
                  {isThis && ping !== null && (
                    <div className="text-[10px] text-deck-dim mt-0.5 flex items-center gap-1">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        ping < 10 ? 'bg-green-400' : ping < 50 ? 'bg-yellow-400' : 'bg-red-400'
                      }`} />
                      {ping}ms
                    </div>
                  )}
                  {isThis && pos && (
                    <div className="text-[10px] text-deck-dim mt-0.5 flex items-center gap-1">
                      <MapPin size={10} className="text-deck-muted/40" />
                      {haversine(pos.lat, pos.lng, ROOM_LAT, ROOM_LNG).toFixed(0)}m
                      {pos.acc > 30 && <span className="text-deck-muted/30">±{pos.acc.toFixed(0)}m</span>}
                    </div>
                  )}
                  {isThis && posErr && (
                    <div className="text-[10px] text-deck-dim mt-0.5">{posErr}</div>
                  )}
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