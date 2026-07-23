import {
  Cpu,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  BatteryWarning,
  BatteryCharging,
  Thermometer,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { MediaState, SystemStats } from '../hooks/useMediaStream';

interface SystemStatsCardProps {
  state: MediaState | null;
}

function BatteryIcon({ stats }: { stats: SystemStats }) {
  if (stats.charging) return <BatteryCharging size={14} />;
  if (stats.battery <= 15) return <BatteryWarning size={14} />;
  if (stats.battery <= 40) return <BatteryLow size={14} />;
  if (stats.battery <= 70) return <BatteryMedium size={14} />;
  return <BatteryFull size={14} />;
}

interface StatBarProps {
  label: string;
  icon: React.ReactNode;
  value: number;
  display: string;
  color: string;
  invert?: boolean;
}

function StatBar({ label, icon, value, display, color }: StatBarProps) {
  const pct = value >= 0 ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="text-center">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim mb-1 flex items-center justify-center gap-1">
        {icon}
        {label}
      </div>
      <div className="h-1 rounded-full overflow-hidden bg-deck-surface2">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="text-sm font-bold mt-1 text-deck-text">{display}</div>
    </div>
  );
}

export default function SystemStatsCard({ state }: SystemStatsCardProps) {
  const sys = state?.sys ?? null;

  if (!sys) {
    return (
      <div className="deck-card">
        <div className="text-xs text-deck-dim text-center">System stats unavailable</div>
      </div>
    );
  }

  const cpuColor = '#06b6d4';
  const ramColor = '#8b5cf6';
  const batColor = '#10b981';
  const tempColor = '#f59e0b';

  const tempDisplay = sys.temp >= 0 ? `${Math.round(sys.temp)}°C` : '--';
  const batDisplay =
    sys.battery >= 0
      ? `${Math.round(sys.battery)}%${sys.charging ? ' ⚡' : ''}`
      : '--';

  const pingIcon = sys.ping_ok ? (
    <Wifi size={14} className="text-deck-accent" />
  ) : (
    <WifiOff size={14} className="text-red-400" />
  );

  const netParts: string[] = [];
  if (sys.ssid) netParts.push(`🏠${sys.ssid}`);
  if (sys.ip) netParts.push(sys.ip);
  netParts.push(`Ping ${sys.ping_ok ? '✓' : '✗'}`);

  return (
    <div className="deck-card flex flex-col gap-2.5">
      <div className="grid grid-cols-4 gap-2">
        <StatBar
          label="CPU"
          icon={<Cpu size={14} className="text-deck-accent" />}
          value={sys.cpu}
          display={sys.cpu >= 0 ? `${Math.round(sys.cpu)}%` : '--'}
          color={cpuColor}
        />
        <StatBar
          label="RAM"
          icon={<Cpu size={14} className="text-purple-400" />}
          value={sys.ram}
          display={sys.ram >= 0 ? `${Math.round(sys.ram)}%` : '--'}
          color={ramColor}
        />
        <StatBar
          label="BAT"
          icon={
            <span className="text-deck-dim">
              <BatteryIcon stats={sys} />
            </span>
          }
          value={sys.battery}
          display={batDisplay}
          color={batColor}
        />
        <StatBar
          label="TEMP"
          icon={<Thermometer size={14} className="text-amber-400" />}
          value={sys.temp >= 0 ? Math.min(100, sys.temp) : -1}
          display={tempDisplay}
          color={tempColor}
        />
      </div>

      <div className="flex justify-center items-center gap-3 text-xs text-deck-dim mt-0.5">
        {netParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1">
            {i === netParts.length - 1 && pingIcon}
            {part}
          </span>
        ))}
      </div>
    </div>
  );
}
