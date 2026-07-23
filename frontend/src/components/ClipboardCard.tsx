import { useState, useRef, useEffect, useCallback } from 'react';
import { Clipboard, ClipboardPaste, ArrowDownLeft, ArrowUpRight, Copy, Check } from 'lucide-react';
import { pullHostClipboard, pushHostClipboard } from '../services/apiService';

type ToastType = 'success' | 'error';

export default function ClipboardCard() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState<'idle' | 'pull' | 'push' | 'push-clipboard'>('idle');
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((msg: string, type: ToastType) => {
    setToast({ msg, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }, []);

  useEffect(() => {
    return () => clearTimeout(toastTimer.current);
  }, []);

  const handlePull = async () => {
    setLoading('pull');
    try {
      const t = await pullHostClipboard();
      setText(t);
      showToast('Pulled from host!', 'success');
    } catch {
      showToast('Pull failed — clipboard tool missing?', 'error');
    } finally {
      setLoading('idle');
    }
    textareaRef.current?.focus();
  };

  const handlePush = async () => {
    if (!text) return;
    setLoading('push');
    try {
      await pushHostClipboard(text);
      showToast('Pushed to host!', 'success');
    } catch {
      showToast('Push failed — clipboard tool missing?', 'error');
    } finally {
      setLoading('idle');
    }
  };

  const handlePushFromClipboard = async () => {
    setLoading('push-clipboard');
    try {
      let t: string;
      try {
        t = await navigator.clipboard.readText();
      } catch {
        const el = document.createElement('textarea');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.focus();
        const ok = document.execCommand('paste');
        t = el.value;
        document.body.removeChild(el);
        if (!ok || !t) throw new Error('paste failed');
      }
      setText(t);
      await pushHostClipboard(t);
      showToast('Pushed tablet clipboard to host!', 'success');
    } catch {
      showToast('Use HTTPS (port 8443) or paste manually', 'error');
    } finally {
      setLoading('idle');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied!', 'success');
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        showToast('Copied!', 'success');
      } catch {
        showToast('Copy failed — use HTTPS (port 8443)', 'error');
      }
    }
  };

  return (
    <div className="deck-card flex flex-col gap-3 relative">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Clipboard size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Clipboard Sync
        </span>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type or paste text, then push to host…"
        rows={3}
        className="w-full bg-deck-surface2/60 border border-white/5 rounded-lg p-2.5
          text-sm text-deck-text placeholder-deck-muted resize-none
          focus:outline-none focus:border-deck-accent/40 focus:ring-1 focus:ring-deck-accent/20
          transition-colors duration-150"
      />

      {/* Action buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={handlePull}
          disabled={loading !== 'idle'}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg
            text-xs font-semibold uppercase tracking-wider
            bg-deck-surface2 border border-white/5 text-deck-text
            hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent
            disabled:opacity-40 disabled:pointer-events-none
            transition-all duration-100 active:scale-95"
        >
          {loading === 'pull' ? (
            <span className="w-3.5 h-3.5 border-2 border-deck-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowDownLeft size={14} />
          )}
          Pull
        </button>

        <button
          onClick={handlePush}
          disabled={!text || loading !== 'idle'}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg
            text-xs font-semibold uppercase tracking-wider
            bg-deck-surface2 border border-white/5 text-deck-text
            hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent
            disabled:opacity-40 disabled:pointer-events-none
            transition-all duration-100 active:scale-95"
        >
          {loading === 'push' ? (
            <span className="w-3.5 h-3.5 border-2 border-deck-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <ArrowUpRight size={14} />
          )}
          Push
        </button>

        <button
          onClick={handlePushFromClipboard}
          disabled={loading !== 'idle'}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg
            text-xs font-semibold uppercase tracking-wider
            bg-deck-surface2 border border-white/5 text-deck-text
            hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent
            disabled:opacity-40 disabled:pointer-events-none
            transition-all duration-100 active:scale-95"
        >
          {loading === 'push-clipboard' ? (
            <span className="w-3.5 h-3.5 border-2 border-deck-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <ClipboardPaste size={14} />
          )}
          Push Tab
        </button>

        <button
          onClick={handleCopy}
          disabled={!text}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg
            text-xs font-semibold uppercase tracking-wider
            bg-deck-surface2 border border-white/5 text-deck-text
            hover:bg-deck-accent/15 hover:border-deck-accent/30 hover:text-deck-accent
            disabled:opacity-40 disabled:pointer-events-none
            transition-all duration-100 active:scale-95"
        >
          <Copy size={14} />
          Copy
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`absolute bottom-14 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg
            text-xs font-semibold shadow-lg pointer-events-none z-10
            transition-all duration-200 ${
              toast.type === 'success'
                ? 'bg-emerald-500/90 text-white'
                : 'bg-red-500/90 text-white'
            }`}
        >
          {toast.type === 'success' ? (
            <span className="inline-flex items-center gap-1">
              <Check size={12} /> {toast.msg}
            </span>
          ) : (
            toast.msg
          )}
        </div>
      )}
    </div>
  );
}
