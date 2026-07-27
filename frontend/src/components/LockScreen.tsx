import { useState, type ReactNode } from 'react';
import { Lock, ArrowLeft } from 'lucide-react';

const STORAGE_KEY = 'dash_auth';
const SIX_HOURS = 6 * 60 * 60 * 1000;

function getStoredAuth(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return false;
  const ts = parseInt(stored, 10);
  if (isNaN(ts)) return false;
  return Date.now() - ts < SIX_HOURS;
}

function setStoredAuth() {
  localStorage.setItem(STORAGE_KEY, String(Date.now()));
}

export default function LockScreen({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(getStoredAuth);
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (p: string[]) => {
    if (p.length !== 4) return;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p.join('') }),
      });
      const data = await res.json();
      if (data.ok) {
        setStoredAuth();
        setAuthed(true);
      } else {
        setError(true);
        setTimeout(() => { setPin([]); setError(false); }, 600);
      }
    } catch {
      setError(true);
      setTimeout(() => { setPin([]); setError(false); }, 600);
    }
    setLoading(false);
  };

  const press = (d: string) => {
    if (pin.length >= 4 || loading) return;
    const next = [...pin, d];
    setPin(next);
    setError(false);
    if (next.length === 4) {
      setTimeout(() => submit(next), 150);
    }
  };

  const backspace = () => {
    if (pin.length === 0 || loading) return;
    setPin(prev => prev.slice(0, -1));
    setError(false);
  };

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0b0d12] p-4">
      <div className="deck-card w-full max-w-[320px] flex flex-col items-center gap-6 py-8">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-deck-accent/10 border border-deck-accent/20 flex items-center justify-center">
          <Lock size={26} className="text-deck-accent" />
        </div>

        {/* Title */}
        <div className="text-center">
          <div className="text-sm font-semibold text-deck-text">Dashboard Locked</div>
          <div className="text-[11px] text-deck-dim mt-1">Enter PIN to unlock</div>
        </div>

        {/* PIN dots */}
        <div className="flex gap-3">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                error
                  ? 'bg-red-400 border-red-400'
                  : pin.length > i
                    ? 'bg-deck-accent border-deck-accent'
                    : 'bg-transparent border-deck-dim/40'
              }`}
            />
          ))}
        </div>
        {error && <div className="text-xs text-red-400 -mt-3">Wrong PIN</div>}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-[220px]">
          {['1','2','3','4','5','6','7','8','9'].map(n => (
            <button
              key={n}
              onPointerDown={() => press(n)}
              className="h-14 rounded-xl text-lg font-semibold text-deck-text
                bg-deck-surface2 border border-white/5
                active:bg-deck-accent/15 active:border-deck-accent/30
                transition-all duration-75 select-none"
            >
              {n}
            </button>
          ))}
          <button
            onPointerDown={() => setPin([])}
            className="h-14 rounded-xl text-xs font-semibold text-deck-dim
              bg-deck-surface2 border border-white/5
              active:bg-deck-accent/15 active:border-deck-accent/30
              transition-all duration-75 select-none"
          >
            Clear
          </button>
          <button
            onPointerDown={() => press('0')}
            className="h-14 rounded-xl text-lg font-semibold text-deck-text
              bg-deck-surface2 border border-white/5
              active:bg-deck-accent/15 active:border-deck-accent/30
              transition-all duration-75 select-none"
          >
            0
          </button>
          <button
            onPointerDown={backspace}
            className="h-14 rounded-xl flex items-center justify-center text-deck-dim
              bg-deck-surface2 border border-white/5
              active:bg-deck-accent/15 active:border-deck-accent/30
              transition-all duration-75 select-none"
          >
            <ArrowLeft size={20} />
          </button>
        </div>

        {loading && (
          <div className="text-xs text-deck-dim">Verifying…</div>
        )}
      </div>
    </div>
  );
}
