import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import PlayerCarousel from '../components/PlayerCarousel';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

import '@xterm/xterm/css/xterm.css';

interface Props { state: MediaState | null; caps: Capabilities }

export default function TerminalDeck({ state, caps }: Props) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);

  const sendToTerminal = (data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(new TextEncoder().encode(data));
    }
  };

  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#06b6d4',
        selectionBackground: '#334155',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc',
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    term.focus();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    // Fit after open and on resize — also send resize to PTY
    const doFit = () => {
      try {
        fitAddon.fit();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsRef.current.send(JSON.stringify({
              type: 'resize',
              rows: dims.rows,
              cols: dims.cols,
            }));
          }
        }
      } catch { /* ignore */ }
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(termRef.current);

    // WebSocket connection
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/terminal`;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        wsRef.current = ws;
        setConnected(true);
        term.clear();
        term.focus();
        doFit();
        // Send initial resize after connection established
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({
            type: 'resize',
            rows: dims.rows,
            cols: dims.cols,
          }));
        }
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(data));
          }
        });
      };

      ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setConnected(false);
        term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n');
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => { ws.close(); };
    };

    connect();

    return () => {
      ro.disconnect();
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      termInstance.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {caps.playerctl && (
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
          <PlayerCarousel players={state?.players ?? []} state={state} />
        </div>
      )}

      <div className="deck-card !p-0 overflow-hidden relative">
        <div ref={termRef} className="w-full h-[360px] md:h-[480px]" />
        <div className={`absolute top-2 right-3 text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${
          connected
            ? 'bg-green-500/15 text-green-400'
            : 'bg-red-500/15 text-red-400'
        }`}>
          {connected ? 'connected' : 'disconnected'}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Quick Actions</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => sendToTerminal('tmux attach -t oc\r')}
            className="px-3 py-2 text-[12px] rounded-md bg-deck-accent/15 border border-deck-accent/20
              text-deck-accent hover:bg-deck-accent/25 active:scale-90 font-mono">
            tmux attach -t oc
          </button>
          <button onClick={() => sendToTerminal('clear\r')}
            className="px-3 py-2 text-[12px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
            clear
          </button>
          <button onClick={() => sendToTerminal('ll\r')}
            className="px-3 py-2 text-[12px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
            ll
          </button>
          <button onClick={() => sendToTerminal('cd ~/Data/Code/Assited/tab-dashboard\r')}
            className="px-3 py-2 text-[12px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
            cd tab-dashboard
          </button>
          <button onClick={() => sendToTerminal('cd ~/Data/Code/Assited/tab-dashboard && go build -o tab-dashboard .\r')}
            className="px-3 py-2 text-[12px] rounded-md bg-white/5 border border-white/5
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
            rebuild
          </button>
          <button onClick={() => sendToTerminal('\x03')}
            className="px-3 py-2 text-[12px] rounded-md bg-red-500/10 border border-red-500/20
              text-red-400 hover:bg-red-500/20 active:scale-90 font-mono">
            Ctrl+C
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Navigation</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
          <div />
          <button onClick={() => sendToTerminal('\x1b[A')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">↑</button>
          <div />
          <button onClick={() => sendToTerminal('\x1b[D')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">←</button>
          <button onClick={() => sendToTerminal('\x1b[B')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">↓</button>
          <button onClick={() => sendToTerminal('\x1b[C')}
            className="px-3 py-2 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent active:scale-90">→</button>
        </div>
      </div>

      {/* Modifiers */}
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Modifiers</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="flex flex-wrap gap-1.5 justify-center">
          {[
            { label: 'ESC', cmd: '\x1b' },
            { label: 'TAB', cmd: '\t' },
            { label: 'Ctrl+C', cmd: '\x03' },
            { label: 'Ctrl+Z', cmd: '\x1a' },
            { label: 'Ctrl+D', cmd: '\x04' },
            { label: 'Ctrl+L', cmd: '\x0c' },
            { label: 'Ctrl+A', cmd: '\x01' },
            { label: 'Ctrl+E', cmd: '\x05' },
            { label: 'Ctrl+W', cmd: '\x17' },
            { label: 'Ctrl+U', cmd: '\x15' },
          ].map(b => (
            <button key={b.label} onClick={() => sendToTerminal(b.cmd)}
              className="px-2.5 py-1.5 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90 font-mono">
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tmux */}
      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Tmux</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '◀ Pane', cmd: '\x02\x1b[A' },
            { label: '▶ Pane', cmd: '\x02\x1b[B' },
            { label: '▲ Pane', cmd: '\x02\x1b[C' },
            { label: '▼ Pane', cmd: '\x02\x1b[D' },
            { label: '⟲ Split H', cmd: '\x02"' },
            { label: '⟳ Split V', cmd: '\x02%' },
            { label: '✦ New Win', cmd: '\x02c' },
            { label: '◀ Win', cmd: '\x02p' },
            { label: '▶ Win', cmd: '\x02n' },
          ].map(b => (
            <button key={b.label} onClick={() => sendToTerminal(b.cmd)}
              className="px-2 py-2 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-deck-muted/50 text-center mt-2">Sends prefix (Ctrl+B) then command</p>
      </div>
    </div>
  );
}
