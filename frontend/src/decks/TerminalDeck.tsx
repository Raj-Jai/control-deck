import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Capabilities } from '../hooks/useCapabilities';
import TmuxRadial from '../components/TmuxRadial';

import '@xterm/xterm/css/xterm.css';

interface Props { caps: Capabilities }

export default function TerminalDeck({ caps }: Props) {
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
        background: '#0f172a', foreground: '#e2e8f0', cursor: '#06b6d4',
        selectionBackground: '#334155', black: '#1e293b', red: '#f87171',
        green: '#4ade80', yellow: '#facc15', blue: '#60a5fa',
        magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0',
        brightBlack: '#475569', brightRed: '#fca5a5', brightGreen: '#86efac',
        brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9', brightWhite: '#f8fafc',
      },
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    term.focus();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    const doFit = () => {
      try {
        fitAddon.fit();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            wsRef.current.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
          }
        }
      } catch { /* ignore */ }
    };
    doFit();
    const ro = new ResizeObserver(doFit);
    ro.observe(termRef.current);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws/terminal`;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let dataDispose: { dispose: () => void } | null = null;
    // Set when the deck is torn down. The socket used to be tracked only in
    // wsRef, which is assigned in onopen: leaving the deck while a connection
    // was still handshaking left that socket with no owner, and when it later
    // closed its onclose scheduled a reconnect that nothing could ever clear.
    // The result was an orphaned PTY and a reconnect loop against a deck that
    // was no longer on screen - one per visit.
    let cancelled = false;
    let current: WebSocket | null = null;

    // Register input handler once — not per reconnect — to avoid duplicate sends
    dataDispose = term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    const connect = () => {
      if (cancelled) return;
      const ws = new WebSocket(wsUrl);
      current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        if (cancelled) { ws.close(); return; }
        wsRef.current = ws;
        setConnected(true);
        term.clear();
        term.focus();
        doFit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', rows: dims.rows, cols: dims.cols }));
        }
      };

      ws.onmessage = (ev) => {
        if (cancelled) return;
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        }
      };

      // Bounded exponential backoff, and say "reconnecting" once rather than
      // appending a line every two seconds for as long as the host is down.
      let attempt = 0;
      let saidOffline = false;

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (cancelled) return;
        setConnected(false);
        if (!saidOffline) {
          saidOffline = true;
          term.write('\r\n\x1b[31m[disconnected — retrying]\x1b[0m\r\n');
        }
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        attempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => { ws.close(); };
    };

    connect();

    return () => {
      cancelled = true;
      ro.disconnect();
      clearTimeout(reconnectTimer);
      dataDispose?.dispose();
      // Close whichever socket this effect opened, including one still
      // handshaking; wsRef alone misses that case.
      if (current) { current.onopen = null; current.onclose = null; current.onmessage = null; current.close(); }
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      term.dispose();
      termInstance.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col min-h-full gap-3">
      {/* Terminal fills the space */}
      <div className="flex-1 deck-card !p-0 overflow-hidden relative flex flex-col min-h-[200px]">
        <div ref={termRef} className="flex-1 min-h-0" />
        {!connected && (
          <div className="absolute inset-0 flex items-center justify-center bg-deck-bg/70 backdrop-blur-[1px]">
            <p className="text-[12px] text-deck-danger">Disconnected — is the deck service running?</p>
          </div>
        )}
        <div className={`absolute top-2 right-3 text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${
          connected ? 'bg-deck-success/15 text-deck-success' : 'bg-deck-danger/15 text-deck-danger'
        }`}>
          {connected ? 'connected' : 'disconnected'}
        </div>
      </div>

      {/* Bottom toolbar — disabled while the socket is down, because every
          button here would otherwise swallow the tap silently. */}
      <div className={`deck-card p-2.5 ${connected ? '' : 'opacity-40 pointer-events-none'}`}
        aria-disabled={!connected}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-0.5 h-3 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Actions</span>
          <div className="flex-1 h-px bg-deck-surface-2" />
          <TmuxRadial sendToTerminal={sendToTerminal} />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => sendToTerminal('tmux attach -t oc\r')}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-accent/15 border border-deck-accent/20 text-deck-accent hover:bg-deck-accent/25 active:scale-90 font-mono">
            tmux attach -t oc
          </button>
          <button onClick={() => sendToTerminal('clear\r')}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90 font-mono">
            clear
          </button>
          <button onClick={() => sendToTerminal('ll\r')}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90 font-mono">
            ll
          </button>
          <button onClick={() => sendToTerminal('cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"\r')}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90 font-mono">
            cd repo root
          </button>
          {/* This overwrites the running binary in place with no undo, so it
              asks first - one tap should not be able to replace the build the
              user is currently running. */}
          <button onClick={() => {
            if (window.confirm(
              'Rebuild now?\n\nThis runs `go build -o tab-dashboard .` in the repo root and\n' +
              'overwrites the binary in place. The running process is not replaced\n' +
              'until the service is restarted.'
            )) {
              sendToTerminal('cd "$(git rev-parse --show-toplevel 2>/dev/null)" && go build -o tab-dashboard .\r');
            }
          }}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90 font-mono">
            rebuild
          </button>
          <button onClick={() => sendToTerminal('\x03')}
            className="min-h-[44px] min-w-[48px] px-3 py-2 text-[11px] rounded-md bg-deck-danger/10 border border-deck-danger/30 text-deck-danger hover:bg-deck-danger/20 active:scale-90 font-mono">
            Ctrl+C
          </button>
          {/* Modifiers */}
          {[
            { label: 'ESC', cmd: '\x1b' },
            { label: 'TAB', cmd: '\t' },
            { label: 'Ctrl+Z', cmd: '\x1a' },
            { label: 'Ctrl+D', cmd: '\x04' },
            { label: 'Ctrl+L', cmd: '\x0c' },
            { label: 'Ctrl+A', cmd: '\x01' },
            { label: 'Ctrl+E', cmd: '\x05' },
            { label: 'Ctrl+W', cmd: '\x17' },
            { label: 'Ctrl+U', cmd: '\x15' },
          ].map(b => (
            <button key={b.label} onClick={() => sendToTerminal(b.cmd)}
              className="min-h-[44px] min-w-[48px] px-2.5 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90 font-mono">
              {b.label}
            </button>
          ))}
          {/* Cursor nav */}
          <div className="inline-grid grid-cols-3 gap-px ml-1">
            <div />
            <button onClick={() => sendToTerminal('\x1b[A')}
              className="min-h-[44px] min-w-[44px] px-2.5 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90">↑</button>
            <div />
            <button onClick={() => sendToTerminal('\x1b[D')}
              className="min-h-[44px] min-w-[44px] px-2.5 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90">←</button>
            <button onClick={() => sendToTerminal('\x1b[B')}
              className="min-h-[44px] min-w-[44px] px-2.5 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90">↓</button>
            <button onClick={() => sendToTerminal('\x1b[C')}
              className="min-h-[44px] min-w-[44px] px-2.5 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15 text-deck-dim hover:text-deck-accent active:scale-90">→</button>
          </div>
        </div>
      </div>
    </div>
  );
}
