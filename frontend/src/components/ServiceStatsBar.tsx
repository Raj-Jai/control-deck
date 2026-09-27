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
      if (document.hidden) return;
      try {
        const res = await fetch('/api/service-stats');
        const data: ServiceInfo[] = await res.json();
        setServices(data);
      } catch { /* ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);

  if (services.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 py-1 text-[11px] text-deck-text/80 font-medium select-none flex-nowrap"
      role="status"
      aria-label="Service status"
    >
      {services.map(s => {
        const running = s.status === 'running';
        return (
          <span key={s.name}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-deck-surface-2
              border border-deck-hairline/10 whitespace-nowrap shrink-0">
            <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 shadow-sm shadow-green-400/40' : 'bg-red-400'}`} />
            <span className="font-bold text-deck-text truncate max-w-[7rem] sm:max-w-[9rem]" title={s.name}>{s.name}</span>
            {running ? (
              <>
                <span className="text-deck-dim flex items-center gap-0.5 whitespace-nowrap">
                  <Activity size={11} className="text-deck-accent" />
                  {s.cpu_percent.toFixed(1)}%
                </span>
                {/* Memory and uptime are the two least load-bearing readings on a
                    phone, and the bar is a single nowrap row, so they were what
                    got clipped off the right edge at 375px. The name and CPU stay
                    at every width. */}
                <span className="hidden sm:flex text-deck-dim items-center gap-0.5 whitespace-nowrap">
                  <HardDrive size={11} className="text-purple-400" />
                  {fmtMem(s.mem_rss_kb)}
                </span>
                <span className="hidden md:flex text-deck-dim items-center gap-0.5 whitespace-nowrap">
                  <Clock size={11} className="text-deck-dim" />
                  {fmtUptime(s.uptime_secs)}
                </span>
              </>
            ) : (
              <span className="text-deck-danger/80 whitespace-nowrap">stopped</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
