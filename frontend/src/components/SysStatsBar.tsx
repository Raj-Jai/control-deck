import { Cpu, Thermometer, Wifi, WifiOff, BatteryFull, BatteryCharging } from 'lucide-react';
import type { MediaState, SystemStats } from '../hooks/useMediaStream';

interface Props { state: MediaState | null }

function fmtGB(kb: number): string {
  if (kb <= 0) return '--';
  return (kb / 1024 / 1024).toFixed(1);
}

export default function SysStatsBar({ state }: Props) {
  const sys: SystemStats | null = state?.sys ?? null;
  if (!sys) return null;

  const ramDisplay = sys.ram >= 0
    ? `${Math.round(sys.ram)}% ${fmtGB(sys.ram_used)}/${fmtGB(sys.ram_total)}GB`
    : null;

  const cpuDisplay = sys.cpu >= 0 ? `${Math.round(sys.cpu)}%` : null;
  const tempDisplay = sys.temp >= 0 ? `${Math.round(sys.temp)}°` : null;

  const batIcon = sys.charging
    ? <BatteryCharging size={12} className="text-green-400" />
    : <BatteryFull size={12} className={sys.battery <= 15 ? 'text-red-400' : 'text-deck-dim'} />;
  const batDisplay = sys.battery >= 0 ? `${Math.round(sys.battery)}%` : null;

  const pingOK = sys.ping_ok;

  return (
    <div className="flex items-center gap-3 px-1 py-1.5 text-[10px] text-deck-muted/60 font-medium select-none">
      {cpuDisplay && (
        <span className="flex items-center gap-1">
          <Cpu size={11} className="text-cyan-400" />
          {cpuDisplay}
        </span>
      )}
      {ramDisplay && (
        <span className="flex items-center gap-1">
          <Cpu size={11} className="text-purple-400" />
          {ramDisplay}
        </span>
      )}
      {batDisplay && (
        <span className="flex items-center gap-1">
          {batIcon}
          {batDisplay}
        </span>
      )}
      {tempDisplay && (
        <span className="flex items-center gap-1">
          <Thermometer size={11} className="text-amber-400" />
          {tempDisplay}
        </span>
      )}
      <span className="flex items-center gap-1">
        {pingOK
          ? <Wifi size={11} className="text-green-400" />
          : <WifiOff size={11} className="text-red-400" />
        }
      </span>
      {sys.ip && <span className="text-deck-muted/40">{sys.ip}</span>}
    </div>
  );
}
