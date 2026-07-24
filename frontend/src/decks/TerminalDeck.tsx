import { triggerCommand } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

export default function TerminalDeck(_props: Props) {
  return (
    <div className="flex flex-col gap-4">
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Navigation</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
          <div />
          <button onClick={() => triggerCommand('key_up')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">↑</button>
          <div />
          <button onClick={() => triggerCommand('key_left')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">←</button>
          <button onClick={() => triggerCommand('key_down')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">↓</button>
          <button onClick={() => triggerCommand('key_right')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">→</button>
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Modifiers</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {[{ label: 'ESC', cmd: 'key_esc' },
            { label: 'TAB', cmd: 'key_tab' },
            { label: 'Ctrl+C', cmd: 'key_ctrl_c' },
            { label: 'Ctrl+Z', cmd: 'key_ctrl_z' },
            { label: 'Ctrl+D', cmd: 'key_ctrl_d' },
            { label: 'Ctrl+L', cmd: 'key_ctrl_l' },
            { label: 'Ctrl+A', cmd: 'key_ctrl_a' },
            { label: 'Ctrl+E', cmd: 'key_ctrl_e' },
            { label: 'Ctrl+W', cmd: 'key_ctrl_w' },
            { label: 'Ctrl+U', cmd: 'key_ctrl_u' },
          ].map(b => (
            <button key={b.cmd} onClick={() => triggerCommand(b.cmd)}
              className="px-2.5 py-1.5 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Tmux</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: '◀ Pane', cmd: 'tmux_pane_l' },
            { label: '▶ Pane', cmd: 'tmux_pane_r' },
            { label: '▲ Pane', cmd: 'tmux_pane_u' },
            { label: '▼ Pane', cmd: 'tmux_pane_d' },
            { label: '⟲ Split H', cmd: 'tmux_split_h' },
            { label: '⟳ Split V', cmd: 'tmux_split_v' },
            { label: '✦ New Win', cmd: 'tmux_new_win' },
            { label: '◀ Win', cmd: 'tmux_win_prev' },
            { label: '▶ Win', cmd: 'tmux_win_next' },
          ].map(b => (
            <button key={b.cmd} onClick={() => triggerCommand(b.cmd)}
              className="px-2 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
