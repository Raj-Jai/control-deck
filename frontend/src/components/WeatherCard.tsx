import { useEffect, useState } from 'react';
import { Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudDrizzle, CloudFog, Wind } from 'lucide-react';

interface WeatherData {
  current: {
    temp: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    code: number;
  };
  daily: Array<{
    date: string;
    code: number;
    tempMax: number;
    tempMin: number;
  }>;
}

function weatherIcon(code: number, size = 20) {
  if (code === 0) return <Sun size={size} />;
  if (code <= 3) return <Cloud size={size} />;
  if (code <= 48) return <CloudFog size={size} />;
  if (code <= 57) return <CloudDrizzle size={size} />;
  if (code <= 67) return <CloudRain size={size} />;
  if (code <= 77) return <CloudSnow size={size} />;
  if (code <= 82) return <CloudRain size={size} />;
  if (code >= 95) return <CloudLightning size={size} />;
  return <Cloud size={size} />;
}

// Open-Meteo returns a bare calendar date such as "2026-01-02" in the
// forecast's own timezone. new Date() parses that as UTC midnight, which is the
// previous day anywhere west of Greenwich, and Math.round then shifted the
// label again. Comparing the calendar parts directly avoids both.
function parseLocalDate(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  const days = Math.round((startOfLocalDay(d) - startOfLocalDay(new Date())) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

const COORD_KEY = 'dash_weather_coords';
const COORD_TTL_MS = 30 * 86400000;
const DEFAULT_COORDS = { lat: 28.6139, lon: 77.2090, label: 'New Delhi' };

function readCachedCoords(): { lat: number; lon: number; label?: string } | null {
  try {
    const raw = localStorage.getItem(COORD_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (typeof c?.lat !== 'number' || typeof c?.lon !== 'number') return null;
    if (Date.now() - (c.at ?? 0) > COORD_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

function cacheCoords(lat: number, lon: number, label?: string) {
  try {
    localStorage.setItem(COORD_KEY, JSON.stringify({ lat, lon, label, at: Date.now() }));
  } catch { /* private mode */ }
}

export default function WeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [place, setPlace] = useState<string>(DEFAULT_COORDS.label);
  // 'idle' until we have something to show: the location prompt is opt-in.
  const [needsLocation, setNeedsLocation] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async (lat: number, lon: number) => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=3`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;

        const c = data.current;
        const d = data.daily;
        setWeather({
          current: {
            temp: c.temperature_2m,
            feelsLike: c.apparent_temperature,
            humidity: c.relative_humidity_2m,
            windSpeed: c.wind_speed_10m,
            code: c.weather_code,
          },
          daily: d.time.map((t: string, i: number) => ({
            date: t,
            code: d.weather_code[i],
            tempMax: d.temperature_2m_max[i],
            tempMin: d.temperature_2m_min[i],
          })),
        });
        setError(null);
      } catch {
        if (!cancelled) setError('Weather unavailable');
      }
      if (!cancelled) setLoading(false);
    };

    const cached = readCachedCoords();
    if (cached) {
      setPlace(cached.label || DEFAULT_COORDS.label);
      fetchWeather(cached.lat, cached.lon);
    } else {
      // Show the fallback immediately and offer the prompt, rather than firing
      // a permission dialog nobody asked for on page load.
      setLoading(false);
      setNeedsLocation(true);
      fetchWeather(DEFAULT_COORDS.lat, DEFAULT_COORDS.lon);
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('This browser cannot share a location');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cacheCoords(pos.coords.latitude, pos.coords.longitude, 'My location');
        setPlace('My location');
        setNeedsLocation(false);
      },
      (err) => {
        setLoading(false);
        setError(err.code === err.PERMISSION_DENIED
          ? 'Location permission denied — showing the default city'
          : 'Could not get a location fix');
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  };

  // Both `loading` and `error` used to return null, so the card did not exist
  // and then popped in, shifting the layout under the user. Always render the
  // frame and say what is happening inside it.
  const header = (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
        Weather
      </span>
      <div className="flex-1 h-px bg-deck-surface-2" />
    </div>
  );

  if (!weather) {
    return (
      <div className="deck-card" role="status">
        {header}
        {loading ? (
          <div className="flex items-center gap-2 text-[12px] text-deck-dim py-1">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-deck-accent/40 border-t-deck-accent animate-spin" />
            Loading weather…
          </div>
        ) : (
          <div className="flex flex-col gap-2 py-1">
            <p className="text-[12px] text-deck-dim">
              {error || 'Weather unavailable — check your connection'}
            </p>
            <p className="text-[11px] text-deck-muted/60">Showing {place}</p>
            <button
              type="button"
              onClick={useMyLocation}
              className="self-start min-h-[44px] px-3 rounded-lg border border-deck-accent/30
                text-deck-accent text-[12px] hover:bg-deck-accent/10"
            >
              Use my location
            </button>
          </div>
        )}
      </div>
    );
  }

  const { current, daily } = weather;

  return (
    <div className="deck-card">
      {header}
      {needsLocation && (
        <button
          type="button"
          onClick={useMyLocation}
          className="mb-2 min-h-[44px] w-full px-3 rounded-lg border border-deck-hairline/15
            text-[12px] text-deck-dim hover:bg-deck-surface-2"
        >
          Showing {place} — use my location
        </button>
      )}

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-deck-accent">{weatherIcon(current.code, 32)}</span>
          <div>
            <div className="text-2xl font-bold text-deck-text">{Math.round(current.temp)}°</div>
            <div className="text-[10px] text-deck-dim">Feels {Math.round(current.feelsLike)}°</div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
            <span className="text-deck-dim">Humidity</span>
            <span className="text-deck-text text-right">{current.humidity}%</span>
            <span className="text-deck-dim">Wind</span>
            <span className="text-deck-text text-right">{current.windSpeed.toFixed(1)} km/h</span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-3 pt-2 border-t border-deck-hairline/10">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 text-center">
            <div className="text-[10px] text-deck-dim mb-1">{dayLabel(d.date)}</div>
            <div className="text-deck-accent">{weatherIcon(d.code, 18)}</div>
            <div className="text-xs font-semibold text-deck-text mt-0.5">
              {Math.round(d.tempMax)}°
            </div>
            <div className="text-[10px] text-deck-muted">{Math.round(d.tempMin)}°</div>
          </div>
        ))}
      </div>
    </div>
  );
}
