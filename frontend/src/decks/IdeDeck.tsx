import { useState } from 'react';
import { triggerCommand } from '../services/apiService';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { caps: Capabilities }

interface Action {
  label: string;
  cmd: string;
  /** Shown in the confirmation prompt. Commands without one are one-tap. */
  confirm?: string;
}

const debugBtns: Action[] = [
  { label: '▶ Continue', cmd: 'dbg_continue' },
  { label: '↷ Step Over', cmd: 'dbg_step_over' },
  { label: '↴ Step Into', cmd: 'dbg_step_into' },
  { label: '↶ Step Out', cmd: 'dbg_step_out' },
  { label: '■ Stop', cmd: 'dbg_stop' },
  { label: '↺ Restart', cmd: 'dbg_restart' },
  { label: 'S: Toggle', cmd: 'dbg_toggle_break' },
  { label: '⊥ Clear All', cmd: 'dbg_clear_all' },
];

// These three run destructive shell commands in the dashboard's working
// directory. They were one tap each, from a tablet, with no confirmation and
// no way to see what they had done.
const gitBtns: Action[] = [
  { label: '■ Stage All', cmd: 'git_stage' },
  {
    label: '✎ Commit',
    cmd: 'git_commit',
    confirm: "Stages every change, commits it as 'dashboard commit' and pushes to origin.",
  },
  { label: '⬆ Push', cmd: 'git_push' },
  { label: '⬇ Pull', cmd: 'git_pull' },
  {
    label: '↺ Reset',
    cmd: 'git_reset',
    confirm: 'Throws away the most recent commit in the repository the deck is running in.',
  },
  {
    label: '‖ Stash',
    cmd: 'git_stash',
    confirm: 'Stashes every uncommitted change in that repository.',
  },
];

const taskBtns: Action[] = [
  { label: '▶ Build', cmd: 'task_build' },
  { label: '▶ Test', cmd: 'task_test' },
  { label: '▶ Lint', cmd: 'task_lint' },
  { label: '▶ Dev', cmd: 'task_dev' },
];

function Card({ title, actions, cols, onRun }: {
  title: string;
  actions: Action[];
  cols: string;
  onRun: (a: Action) => void;
}) {
  return (
    <div className="deck-card p-3">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">{title}</span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>
      <div className={`grid ${cols} gap-2`}>
        {actions.map(b => (
          <button
            key={b.cmd}
            onClick={() => onRun(b)}
            aria-label={b.label}
            className={`min-h-[44px] px-2 py-2 text-[11px] rounded-md border text-center leading-tight
              active:scale-90 ${
                b.confirm
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-200 hover:bg-amber-500/20'
                  : 'bg-white/5 border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
              }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function IdeDeck({ caps }: Props) {
  // Armed action awaiting a second tap, plus the last result. Output still goes
  // to the host's stdout, so this is the only feedback the deck can give.
  const [armed, setArmed] = useState<Action | null>(null);
  const [last, setLast] = useState<{ cmd: string; ok: boolean; at: number } | null>(null);

  const run = async (a: Action) => {
    if (a.confirm && armed?.cmd !== a.cmd) {
      setArmed(a);
      return;
    }
    setArmed(null);
    const ok = await triggerCommand(a.cmd);
    setLast({ cmd: a.cmd, ok, at: Date.now() });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Debug" actions={debugBtns} cols="grid-cols-4" onRun={run} />
      <Card title="Git" actions={gitBtns} cols="grid-cols-3" onRun={run} />

      {armed && (
        <div role="alertdialog" aria-label={`Confirm ${armed.label}`}
          className="deck-card border-amber-500/40 flex flex-col gap-2.5">
          <p className="text-[12px] text-amber-200">
            <span className="font-semibold">{armed.label}:</span> {armed.confirm}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => run(armed)}
              className="min-h-[44px] px-4 rounded-lg bg-amber-500/20 border border-amber-500/40
                text-amber-100 text-[12px] font-semibold"
            >
              Run it
            </button>
            <button
              onClick={() => setArmed(null)}
              className="min-h-[44px] px-4 rounded-lg bg-white/5 border border-white/10
                text-deck-dim text-[12px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {last && (
        <p role="status"
          className={`text-[11px] ${last.ok ? 'text-deck-muted/60' : 'text-red-400'}`}>
          {last.ok ? 'Dispatched' : 'Failed to dispatch'} <code>{last.cmd}</code> — output goes to the
          host terminal, not here.
        </p>
      )}

      <Card title="Tasks" actions={taskBtns} cols="grid-cols-2" onRun={run} />
    </div>
  );
}
