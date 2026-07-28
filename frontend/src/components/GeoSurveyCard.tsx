import { useEffect, useState, useRef, useCallback } from 'react';
import { Play, Square, MapPin, Save, FolderOpen, Trash2, Crosshair, Target } from 'lucide-react';

const STORED_CENTER_KEY = 'geo_room_center';
const DEFAULT_LAT = 22.321917;
const DEFAULT_LNG = 87.303572;

function loadCenter(): { lat: number; lng: number } {
  try {
    const raw = localStorage.getItem(STORED_CENTER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
}

function storeCenter(lat: number, lng: number) {
  localStorage.setItem(STORED_CENTER_KEY, JSON.stringify({ lat, lng }));
}

interface Point {
  lat: number;
  lng: number;
  ping: number;
  ts: number;
}

function toRad(d: number) { return d * Math.PI / 180; }

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localMeters(lat: number, lng: number, originLat: number, originLng: number): [number, number] {
  const x = haversine(originLat, originLng, originLat, lng) * (lng > originLng ? 1 : -1);
  const y = haversine(originLat, originLng, lat, originLng) * (lat > originLat ? 1 : -1);
  return [x, y];
}

function pingColor(ping: number): string {
  if (ping < 10) return '#22c55e';
  if (ping < 30) return '#eab308';
  if (ping < 50) return '#f97316';
  return '#ef4444';
}

const CALIB_DURATION = 30_000; // 30 seconds

export default function GeoSurveyCard() {
  const [roomCenter, setRoomCenter] = useState(loadCenter);
  const [recording, setRecording] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibSamples, setCalibSamples] = useState<{ lat: number; lng: number }[]>([]);
  const [calibResult, setCalibResult] = useState<{ lat: number; lng: number; n: number } | null>(null);
  const [calibProgress, setCalibProgress] = useState(0);
  const [points, setPoints] = useState<Point[]>([]);
  const [currPos, setCurrPos] = useState<{ lat: number; lng: number } | null>(null);
  const [currPing, setCurrPing] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPing = useRef(0);
  const calibStart = useRef(0);

  const addPoint = useCallback(() => {
    if (!currPos || !currPing) return;
    setPoints(prev => [...prev, { ...currPos, ping: currPing, ts: Date.now() }]);
  }, [currPos, currPing]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(addPoint, 200);
    return () => clearInterval(id);
  }, [recording, addPoint]);

  // GPS watch
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setCurrPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 1000, maximumAge: 200 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Calibration: collect GPS samples for CALIB_DURATION
  useEffect(() => {
    if (!calibrating) return;
    calibStart.current = Date.now();
    setCalibSamples([]);
    setCalibResult(null);
    const id = setInterval(() => {
      setCalibProgress(Date.now() - calibStart.current);
    }, 100);
    return () => clearInterval(id);
  }, [calibrating]);

  useEffect(() => {
    if (!calibrating || !currPos) return;
    const elapsed = Date.now() - calibStart.current;
    if (elapsed >= CALIB_DURATION) {
      // compute average
      const total = calibSamples.length + 1;
      const sum = calibSamples.reduce((a, c) => ({ lat: a.lat + c.lat, lng: a.lng + c.lng }), { lat: currPos.lat, lng: currPos.lng });
      setCalibResult({ lat: sum.lat / total, lng: sum.lng / total, n: total });
      setCalibrating(false);
      setCalibProgress(0);
      return;
    }
    setCalibSamples(prev => [...prev, currPos]);
  }, [currPos, calibrating, calibSamples]);

  // Ping polling
  useEffect(() => {
    const measure = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/ping', { method: 'HEAD', cache: 'no-store' });
        lastPing.current = Math.round(performance.now() - t0);
        setCurrPing(lastPing.current);
      } catch {}
    };
    measure();
    const id = setInterval(measure, 200);
    return () => clearInterval(id);
  }, []);

  const [sessionList, setSessionList] = useState<string[]>([]);
  const [loadedSession, setLoadedSession] = useState<{ name: string; points: Point[] } | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  const saveSession = async () => {
    const name = sessionName.trim() || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      const res = await fetch('/api/geo/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, points: points.map(p => ({ ...p, ts: p.ts })) }),
      });
      const data = await res.json();
      if (data.ok) { setSaveMsg(`Saved: ${data.ok}`); loadSessions(); }
      else setSaveMsg('Save failed');
    } catch { setSaveMsg('Save error'); }
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const loadSessions = async () => {
    try { const res = await fetch('/api/geo/sessions'); setSessionList(await res.json()); }
    catch {}
  };

  const loadSession = async (name: string) => {
    try {
      const res = await fetch(`/api/geo/session?name=${encodeURIComponent(name)}`);
      const points: Point[] = await res.json();
      setLoadedSession({ name, points });
    } catch {}
  };

  const deleteSession = async (name: string) => {
    try {
      await fetch(`/api/geo/session?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (loadedSession?.name === name) setLoadedSession(null);
      loadSessions();
    } catch {}
  };

  useEffect(() => { loadSessions(); }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Collect all coordinates to bound
    const coords: [number, number][] = [];
    if (currPos) coords.push([currPos.lat, currPos.lng]);
    coords.push([roomCenter.lat, roomCenter.lng]);
    for (const p of points) coords.push([p.lat, p.lng]);
    if (loadedSession) for (const p of loadedSession.points) coords.push([p.lat, p.lng]);

    if (coords.length === 0) return;

    // Compute bounding box
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const [lat, lng] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    const pad = 1e-5;
    minLat -= pad; maxLat += pad;
    minLng -= pad; maxLng += pad;

    const rangeLat = maxLat - minLat || 1e-6;
    const rangeLng = maxLng - minLng || 1e-6;

    const toScreen = (lat: number, lng: number): [number, number] => {
      const x = ((lng - minLng) / rangeLng) * (W - 40) + 20;
      const y = ((maxLat - lat) / rangeLat) * (H - 40) + 20;
      return [x, y];
    };

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = (W / 5) * i;
      const y = (H / 5) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Draw path lines
    if (points.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const [sx, sy] = toScreen(points[i].lat, points[i].lng);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Draw recorded points
    for (const p of points) {
      const [sx, sy] = toScreen(p.lat, p.lng);
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = pingColor(p.ping);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw loaded session points
    if (loadedSession) {
      for (const p of loadedSession.points) {
        const [sx, sy] = toScreen(p.lat, p.lng);
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Room center
    {
      const [sx, sy] = toScreen(roomCenter.lat, roomCenter.lng);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy);
      ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CENTER', sx, sy + 18);
    }

    // Current position
    if (currPos) {
      const [sx, sy] = toScreen(currPos.lat, currPos.lng);
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(59,130,246,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#3b82f6';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', sx, sy + 18);
    }
  }, [points, currPos, loadedSession]);

  return (
    <div className="deck-card flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <MapPin size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Geo Survey
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
        <button
          onPointerDown={() => setRecording(!recording)}
          className={`icon-btn w-7 h-7 ${recording ? 'text-red-400 bg-red-500/15 border-red-500/20' : ''}`}
          title={recording ? 'Stop recording' : 'Start recording'}
        >
          {recording ? <Square size={12} /> : <Play size={12} />}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={600}
        height={400}
        className="w-full h-auto rounded-lg bg-black/20 border border-white/[0.04]"
        style={{ aspectRatio: '3/2' }}
      />

      <div className="flex items-center gap-3 text-[10px] text-deck-dim flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Center
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> You
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> &lt;10ms
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> 10-30ms
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> 30-50ms
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> &gt;50ms
        </span>
        {recording && <span className="text-red-400 ml-auto animate-pulse">REC</span>}
      </div>

      <div className="text-[10px] text-deck-dim">
        Points: {points.length}
        {currPing !== null && <> · Ping: {currPing}ms</>}
        {currPos && <> · Dist: {haversine(currPos.lat, currPos.lng, roomCenter.lat, roomCenter.lng).toFixed(0)}m</>}
        {loadedSession && <> · Loaded: {loadedSession.name} ({loadedSession.points.length}pts)</>}
        {!roomCenter || (roomCenter.lat === DEFAULT_LAT && roomCenter.lng === DEFAULT_LNG) && <span className="text-amber-400"> ⚠ default</span>}
      </div>

      {/* Calibrate button & progress */}
      <div className="flex items-center gap-2">
        <button
          onPointerDown={() => setCalibrating(true)}
          disabled={calibrating}
          className="icon-btn h-7 px-2 flex items-center gap-1.5 text-[10px] font-medium disabled:opacity-50"
          title="Record GPS for 30s to average room center"
        >
          <Crosshair size={12} />
          Calibrate Center
        </button>
        {calibrating && (
          <div className="flex items-center gap-2 flex-1">
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-deck-accent transition-all duration-200"
                style={{ width: `${Math.min(100, (calibProgress / CALIB_DURATION) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-deck-dim w-12">{Math.round(calibProgress / 1000)}s</span>
          </div>
        )}
      </div>

      {/* Calibration result */}
      {calibResult && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-deck-accent/8 border border-deck-accent/15">
          <Target size={12} className="text-deck-accent flex-shrink-0" />
          <div className="flex-1 text-[10px] text-deck-dim">
            Calibrated: {calibResult.lat.toFixed(6)}, {calibResult.lng.toFixed(6)} ({calibResult.n} samples)
          </div>
          <button
            onPointerDown={() => {
              storeCenter(calibResult.lat, calibResult.lng);
              setRoomCenter({ lat: calibResult.lat, lng: calibResult.lng });
              setCalibResult(null);
            }}
            className="text-[10px] font-medium text-deck-accent hover:text-white px-2 py-0.5 rounded border border-deck-accent/20"
          >
            Set as center
          </button>
        </div>
      )}

      {/* Save */}
      <div className="flex items-center gap-2">
        <input
          value={sessionName}
          onChange={e => setSessionName(e.target.value)}
          placeholder="Session name (optional)"
          className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1 text-[11px] text-deck-text
            placeholder:text-deck-muted/30 outline-none focus:border-deck-accent/30"
        />
        <button
          onPointerDown={saveSession}
          disabled={points.length === 0}
          className="icon-btn w-7 h-7 flex-shrink-0 disabled:opacity-30"
          title="Save session"
        >
          <Save size={12} />
        </button>
        {saveMsg && <span className="text-[10px] text-deck-dim ml-1">{saveMsg}</span>}
      </div>

      {/* Session list */}
      {sessionList.length > 0 && (
        <div className="flex flex-col gap-1 max-h-24 overflow-y-auto">
          {sessionList.map(name => (
            <div key={name}
              className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] cursor-pointer
                ${loadedSession?.name === name ? 'bg-deck-accent/10 border border-deck-accent/20' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}
              onPointerDown={() => loadSession(name)}
            >
              <FolderOpen size={10} className="text-deck-muted/40 flex-shrink-0" />
              <span className="flex-1 truncate text-deck-text">{name.replace('.json','')}</span>
              <button
                onPointerDown={e => { e.stopPropagation(); deleteSession(name); }}
                className="icon-btn w-5 h-5 text-deck-dim hover:text-red-400 flex-shrink-0"
                title="Delete"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
