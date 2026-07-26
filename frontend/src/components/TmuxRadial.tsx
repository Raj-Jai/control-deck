import { useState } from 'react';
import { Layout, Minimize2, Maximize2, PanelBottom, PanelRight, ChevronLeft, ChevronRight } from 'lucide-react';

interface TmuxRadialProps {
  sendToTerminal: (data: string) => void;
}

const items = [
  { label: 'Pane ◀', cmd: '\x02\x1b[D', icon: ChevronLeft },
  { label: 'Pane ▼', cmd: '\x02\x1b[B', icon: ChevronLeft, rot: 90 },
  { label: 'Pane ▶', cmd: '\x02\x1b[C', icon: ChevronLeft, rot: 180 },
  { label: 'Pane ▲', cmd: '\x02\x1b[A', icon: ChevronLeft, rot: 270 },
  { label: 'Split V', cmd: '\x02%', icon: PanelRight },
  { label: 'Split H', cmd: '\x02"', icon: PanelBottom },
  { label: 'New Win', cmd: '\x02c', icon: Maximize2 },
  { label: 'Win ◀', cmd: '\x02p', icon: ChevronLeft },
  { label: 'Win ▶', cmd: '\x02n', icon: ChevronRight },
];

export default function TmuxRadial({ sendToTerminal }: TmuxRadialProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* backdrop */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-10 h-10 rounded-full shadow-lg flex items-center justify-center
          bg-deck-accent/20 border border-deck-accent/30 text-deck-accent
          hover:bg-deck-accent/30 active:scale-90 transition-all backdrop-blur-xl"
        title="Tmux controls"
      >
        <Layout size={18} />
      </button>

      {/* Radial menu */}
      {open && (
        <div className="absolute bottom-full right-0 mb-2 z-50">
          <div className="grid grid-cols-3 gap-1.5 p-2 bg-deck-bg/95 backdrop-blur-xl border border-white/[0.08] rounded-xl shadow-2xl min-w-[200px]">
            {items.map(item => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => { sendToTerminal(item.cmd); setOpen(false); }}
                  className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg text-[10px]
                    text-deck-dim hover:text-deck-accent hover:bg-white/5 active:scale-90 transition-all"
                >
                  <Icon size={16} style={item.rot ? { transform: `rotate(${item.rot}deg)` } : undefined} />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
