import { Terminal } from 'lucide-react';
import type { CmdLogEntry } from '../hooks/useMediaStream';

interface Props {
  log: CmdLogEntry[];
}

export default function CommandLogCard({ log }: Props) {
  // An empty log used to render nothing at all, so the Home deck's right
  // column changed height every time a command ran — the card moved under
  // the user's finger. Render the frame with an explicit empty state.
  const empty = !log || log.length === 0;

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2 mb-2">
        <Terminal size={14} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Command Log
        </span>
      </div>
      {empty ? (
        <p className="text-[11px] text-deck-dim py-1">No commands yet</p>
      ) : (
        <div className="max-h-[200px] min-h-[72px] overflow-y-auto space-y-0.5 font-mono text-[12px] leading-relaxed">
          {[...log].reverse().map((e) => (
            <div key={`${e.time}-${e.command}`} className="flex gap-2 text-deck-dim">
              <span className="text-deck-muted shrink-0">{e.time}</span>
              <span className="text-deck-text/80 truncate">{e.command}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
