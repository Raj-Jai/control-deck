import { useEffect, useState, useRef } from 'react';
import { Cpu, HardDrive, Clock, Activity } from 'lucide-react';

interface ServiceInfo {
  name: string;
  pid: number;
  cpu_percent: number;
  mem_rss_kb: number;
  status: string;
  uptime_secs: number;
}

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function fmtMem(kb: number): string {
  if (kb < 1024) return `${kb}K`;
  return (kb / 1024).toFixed(1) + 'M';
}

export default function ServiceStatsBar() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/service-stats');
        const data: ServiceInfo[] = await res.json();
        setServices(data);
      } catch { /* ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  if (services.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-1 py-1 text-[11px] text-deck-text/80 font-medium select-none">
      {services.map(s => {
        const running = s.status === 'running';
        return (
          <span key={s.name}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
            <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 shadow-sm shadow-green-400/40' : 'bg-red-400'}`} />
            <span className="font-bold text-deck-text">{s.name}</span>
            {running ? (
              <>
                <span className="text-deck-muted/70 flex items-center gap-0.5">
                  <Activity size={11} className="text-cyan-400" />
                  {s.cpu_percent.toFixed(1)}%
                </span>
                <span className="text-deck-muted/70 flex items-center gap-0.5">
                  <HardDrive size={11} className="text-purple-400" />
                  {fmtMem(s.mem_rss_kb)}
                </span>
                <span className="text-deck-muted/70 flex items-center gap-0.5">
                  <Clock size={11} className="text-deck-muted/50" />
                  {fmtUptime(s.uptime_secs)}
                </span>
              </>
            ) : (
              <span className="text-red-400/80">stopped</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
