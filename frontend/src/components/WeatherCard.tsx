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

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export default function WeatherCard() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

    // Try browser geolocation, fall back to a default coordinate
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => fetchWeather(28.6139, 77.2090), // fallback
        { timeout: 5000, enableHighAccuracy: false }
      );
    } else {
      fetchWeather(28.6139, 77.2090); // fallback
    }

    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (error) return null;
  if (!weather) return null;

  const { current, daily } = weather;

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          Weather
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

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

      <div className="flex gap-2 mt-3 pt-2 border-t border-white/[0.06]">
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
