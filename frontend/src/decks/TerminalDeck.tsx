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

    // Fit after open and on resize
    const doFit = () => {
      try { fitAddon.fit(); } catch { /* ignore */ }
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
    </div>
  );
}
