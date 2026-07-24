import { Terminal } from 'lucide-react';
import type { CmdLogEntry } from '../hooks/useMediaStream';

interface Props {
  log: CmdLogEntry[];
}

export default function CommandLogCard({ log }: Props) {
  if (!log || log.length === 0) return null;

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2 mb-2">
        <Terminal size={14} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Command Log
        </span>
      </div>
      <div className="max-h-[200px] overflow-y-auto space-y-0.5 font-mono text-[11px] leading-relaxed">
        {[...log].reverse().map((e, i) => (
          <div key={i} className="flex gap-2 text-deck-dim">
            <span className="text-deck-muted shrink-0">{e.time}</span>
            <span className="text-deck-text/80 truncate">{e.command}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
