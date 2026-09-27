import { useRef, useState } from 'react';
import { setToken, getToken, clearToken } from '../lib/session';
import { Lock, Music, LayoutDashboard, ArrowLeft } from 'lucide-react';

type AuthMode = 'dashboard' | 'media';

interface AuthScreenProps {
  onAuth: (mode: AuthMode) => void;
}

const STORAGE_KEY = 'dash_auth_mode';

export function getStoredMode(): AuthMode | null {
  // The remembered mode is only honoured while a live session token exists.
  // sessionStorage is per-tab, so opening the dashboard in a second tab now
  // correctly asks for the PIN instead of rendering an app whose every
  // request would 401.
  if (!getToken()) return null;
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
  clearToken();
}

export default function AuthScreen({ onAuth }: AuthScreenProps) {
  const [step, setStep] = useState<'pick' | 'pin'>('pick');
  const [mode, setMode] = useState<AuthMode>('dashboard');
  const [pin, setPin] = useState<string[]>([]);
  const [error, setError] = useState<'wrong' | 'offline' | null>(null);
  const [loading, setLoading] = useState(false);
  // A ref, not state: a 150ms state update was long enough for backspace and
  // Clear to be accepted after the 4th digit, then wiped by the submit.
  const submitting = useRef(false);

  const submit = async (p: string[]) => {
    if (p.length !== 4 || submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);
    const endpoint = mode === 'media' ? '/api/auth-media' : '/api/auth';
    // Without a timeout a hung request disables the keypad permanently.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p.join('') }),
        signal: ac.signal,
      });
      if (res.status === 429) {
        setError('offline');
        return;
      }
      const data = await res.json();
      if (data.ok) {
        // The server now mints a session token; without it every other
        // endpoint answers 401.
        if (data.token) setToken(data.token);
        setStoredMode(mode);
        onAuth(mode);
        return;
      }
      setError('wrong');
      setTimeout(() => { setPin([]); setError(null); }, 600);
    } catch {
      // A network failure is not a wrong PIN, and saying so sends people
      // hunting for a typo that does not exist.
      setError('offline');
    } finally {
      clearTimeout(timer);
      submitting.current = false;
      setLoading(false);
    }
  };

  const press = (d: string) => {
    if (pin.length >= 4 || loading || submitting.current) return;
    const next = [...pin, d];
    setPin(next);
    setError(null);
    if (next.length === 4) submit(next);
  };

  const backspace = () => {
    if (pin.length === 0 || loading || submitting.current) return;
    setPin(prev => prev.slice(0, -1));
    setError(null);
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
                onClick={() => { setMode('dashboard'); setStep('pin'); }}
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
                onClick={() => { setMode('media'); setStep('pin'); }}
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
              onClick={() => { setStep('pick'); setPin([]); setError(null); }}
              aria-label="Back to mode selection"
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
              <p className="text-[10px] text-deck-muted/50 mt-2 max-w-[240px] text-center leading-snug">
                This locks the screen on this device only. It does not protect the host.
              </p>
            </div>

            <div className="flex gap-3" role="status" aria-label={`PIN ${pin.length} of 4 digits entered`}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                  error ? 'bg-red-400 border-red-400'
                  : pin.length > i ? 'bg-deck-accent border-deck-accent'
                  : 'bg-transparent border-deck-dim/40'
                }`} />
              ))}
            </div>
            {error === 'wrong' && (
              <div className="text-xs text-red-400 -mt-3" role="alert">Wrong PIN</div>
            )}
            {error === 'offline' && (
              <div className="flex flex-col items-center gap-2 -mt-3" role="alert">
                <p className="text-xs text-amber-300 text-center">
                  Can&apos;t reach the deck — is it still running?
                </p>
                <button
                  onClick={() => { setPin([]); setError(null); }}
                  className="min-h-[44px] px-4 rounded-lg border border-white/10
                    text-[12px] text-deck-dim hover:bg-white/5"
                >
                  Retry
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 w-full max-w-[220px]">
              {['1','2','3','4','5','6','7','8','9'].map(n => (
                <button key={n} onClick={() => press(n)} aria-label={`Digit ${n}`}
                  className="h-14 rounded-xl text-lg font-semibold text-deck-text bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                  {n}
                </button>
              ))}
              <button onClick={() => setPin([])} aria-label="Clear PIN"
                className="h-14 rounded-xl text-xs font-semibold text-deck-dim bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                Clear
              </button>
              <button onClick={() => press('0')} aria-label="Digit 0"
                className="h-14 rounded-xl text-lg font-semibold text-deck-text bg-deck-surface2 border border-white/5 active:bg-deck-accent/15 active:border-deck-accent/30 transition-all duration-75 select-none">
                0
              </button>
              <button onClick={backspace} aria-label="Delete last digit"
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
