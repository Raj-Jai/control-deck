import { useState } from 'react';
import { Lock, Music, LayoutDashboard, ArrowLeft } from 'lucide-react';

type AuthMode = 'dashboard' | 'media';

interface AuthScreenProps {
  onAuth: (mode: AuthMode) => void;
}

const STORAGE_KEY = 'dash_auth_mode';

export function getStoredMode(): AuthMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data.ts < 6 * 60 * 60 * 1000) return data.mode;
  } catch {}
  return null;
}

function setStoredMode(mode: AuthMode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, ts: Date.now() }));
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function AuthScreen({ onAuth }: AuthScreenProps) {
  const [step, setStep] = useState<'pick' | 'pin'>('pick');
  const [mode, setMode] = useState<AuthMode>('dashboard');
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (p: string[]) => {
    if (p.length !== 4) return;
    setLoading(true);
    setError(false);
    const endpoint = mode === 'media' ? '/api/auth-media' : '/api/auth';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p.join('') }),
      });
      const data = await res.json();
      if (data.ok) {
        setStoredMode(mode);
        onAuth(mode);
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

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[#0b0d12] p-4">
      <div className="deck-card w-full max-w-[320px] flex flex-col items-center gap-6 py-8">
        <div className="w-14 h-14 rounded-2xl bg-deck-accent/10 border border-deck-accent/20 flex items-center justify-center">
          <Lock size={26} className="text-deck-accent" />
        </div>

        {step === 'pick' ? (
          <>
            <div className="text-center">
              <div className="text-sm font-semibold text-deck-text">Control Deck</div>
              <div className="text-[11px] text-deck-dim mt-1">Choose access mode</div>
            </div>

            <div className="flex flex-col gap-3 w-full max-w-[220px]">
              <button
                onPointerDown={() => { setMode('dashboard'); setStep('pin'); }}
                className="flex items-center gap-3 h-14 px-4 rounded-xl text-sm font-semibold text-deck-text
                  bg-deck-surface2 border border-white/5
                  hover:bg-deck-accent/10 hover:border-deck-accent/20
                  active:bg-deck-accent/15 active:border-deck-accent/30
                  transition-all duration-75 select-none"
              >
                <LayoutDashboard size={18} className="text-deck-accent" />
                Full Dashboard
              </button>
              <button
                onPointerDown={() => { setMode('media'); setStep('pin'); }}
                className="flex items-center gap-3 h-14 px-4 rounded-xl text-sm font-semibold text-deck-text
                  bg-deck-surface2 border border-white/5
                  hover:bg-amber-500/10 hover:border-amber-500/20
                  active:bg-amber-500/15 active:border-amber-500/30
                  transition-all duration-75 select-none"
              >
                <Music size={18} className="text-amber-400" />
                Media Streamer
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onPointerDown={() => { setStep('pick'); setPin([]); setError(false); }}
              className="self-start -mt-2 -ml-2 w-8 h-8 flex items-center justify-center rounded-lg
                text-deck-dim hover:text-deck-text hover:bg-white/5 transition-colors"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="text-center">
              <div className="text-sm font-semibold text-deck-text">
                {mode === 'media' ? 'Media Streamer' : 'Dashboard'}
              </div>
              <div className="text-[11px] text-deck-dim mt-1">Enter PIN to unlock</div>
            </div>

            <div className="flex gap-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                  error ? 'bg-red-400 border-red-400'
                  : pin.length > i ? 'bg-deck-accent border-deck-accent'
                  : 'bg-transparent border-deck-dim/40'
                }`} />
              ))}
            </div>
            {error && <div className="text-xs text-red-400 -mt-3">Wrong PIN</div>}

            <div className="grid grid-cols-3 gap-3 w-full max-w-[220px]">
              {['1','2','3','4','5','6','7','8','9'].map(n => (
                <button key={n} onPointerDown={() => press(n)}
                  className="h-14 rounded-xl text-lg font-semibold text-deck-text bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                  {n}
                </button>
              ))}
              <button onPointerDown={() => setPin([])}
                className="h-14 rounded-xl text-xs font-semibold text-deck-dim bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                Clear
              </button>
              <button onPointerDown={() => press('0')}
                className="h-14 rounded-xl text-lg font-semibold text-deck-text bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                0
              </button>
              <button onPointerDown={backspace}
                className="h-14 rounded-xl flex items-center justify-center text-deck-dim bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                <ArrowLeft size={20} />
              </button>
            </div>

            {loading && <div className="text-xs text-deck-dim">Verifying…</div>}
          </>
        )}
      </div>
    </div>
  );
}
