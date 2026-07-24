import { triggerCommand } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

export default function IdeDeck(_props: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Debug</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[{ label: '▶ Continue', cmd: 'dbg_continue' },
            { label: '↷ Step Over', cmd: 'dbg_step_over' },
            { label: '↴ Step Into', cmd: 'dbg_step_into' },
            { label: '↶ Step Out', cmd: 'dbg_step_out' },
            { label: '■ Stop', cmd: 'dbg_stop' },
            { label: '↺ Restart', cmd: 'dbg_restart' },
            { label: 'S: Toggle', cmd: 'dbg_toggle_break' },
            { label: '⊥ Clear All', cmd: 'dbg_clear_all' },
          ].map(b => (
            <button key={b.cmd} onClick={() => triggerCommand(b.cmd)}
              className="px-2 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 text-center leading-tight">
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Git</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: '■ Stage All', cmd: 'git_stage' },
            { label: '✎ Commit', cmd: 'git_commit' },
            { label: '⬆ Push', cmd: 'git_push' },
            { label: '⬇ Pull', cmd: 'git_pull' },
            { label: '↺ Reset', cmd: 'git_reset' },
            { label: '‖ Stash', cmd: 'git_stash' },
          ].map(b => (
            <button key={b.cmd} onClick={() => triggerCommand(b.cmd)}
              className="px-2 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 text-center">
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Tasks</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[{ label: '▶ Build', cmd: 'task_build' },
            { label: '▶ Test', cmd: 'task_test' },
            { label: '▶ Lint', cmd: 'task_lint' },
            { label: '▶ Dev', cmd: 'task_dev' },
          ].map(b => (
            <button key={b.cmd} onClick={() => triggerCommand(b.cmd)}
              className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
