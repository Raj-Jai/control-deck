import { useState, useCallback } from 'react';
import { Navigation, Check, RefreshCw } from 'lucide-react';

interface FloatingNavProps {
  pages: readonly { id: string; label: string }[];
  currentPage: number;
  scrollTo: (index: number) => void;
  autoFocus: boolean;
  onToggleAutoFocus: () => void;
  /** True when the MiniPlayer is docked at the bottom, so the FAB can sit
   *  clear of it instead of covering the next-track button. */
  raised?: boolean;
  /** True when a broadcast is live, so Refresh can say so before it ends one. */
  broadcasting?: boolean;
}

export default function FloatingNav({ pages, currentPage, scrollTo, autoFocus, onToggleAutoFocus, raised, broadcasting = false }: FloatingNavProps) {
  const [open, setOpen] = useState(false);
  // A reload drops this client's socket, which ends the broadcast for every
  // device, not just this one. So Refresh always takes two taps, and the second
  // one says what it will cost.
  const [armed, setArmed] = useState(false);

  const handleNav = useCallback((i: number) => {
    scrollTo(i);
    setOpen(false);
  }, [scrollTo]);

  return (
    <div className={`fixed right-3 z-50 transition-[bottom] duration-200 ${raised ? 'bottom-[7.5rem]' : 'bottom-[4.75rem]'}`}>
      {/* Backdrop overlay */}
      {open && (
        <div
          className="fixed inset-0 -z-10"
          onClick={() => { setOpen(false); setArmed(false); }}
          aria-hidden="true"
        />
      )}

      {/* Menu */}
      {open && (
        <div
          role="menu"
          aria-label="Deck navigation"
          className="absolute bottom-full right-0 mb-3 min-w-[180px] z-50
            bg-deck-bg/95 backdrop-blur-xl border border-white/[0.08] rounded-xl p-2 shadow-2xl"
        >
          <div className="flex flex-col gap-0.5">
            {pages.map((p, i) => (
              <button
                key={p.id}
                role="menuitem"
                onClick={() => handleNav(i)}
                className={`px-3 py-2.5 min-h-[44px] text-[13px] rounded-lg flex items-center text-left transition-all ${
                  i === currentPage
                    ? 'bg-deck-accent/20 text-deck-accent font-semibold'
                    : 'text-deck-dim hover:text-deck-text hover:bg-white/5'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-white/[0.06] my-1.5" />

          <button
            role="menuitem"
            onClick={onToggleAutoFocus}
            className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] text-[13px] rounded-lg flex items-center
              text-deck-dim hover:text-deck-text hover:bg-white/5 transition-all"
          >
            <span>Auto-focus</span>
            <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
              autoFocus ? 'bg-deck-accent' : 'border border-white/20'
            }`}>
              {autoFocus && <Check size={12} className="text-white" strokeWidth={3} />}
            </span>
          </button>

          <button
            role="menuitem"
            onClick={() => {
              if (armed) {
                setArmed(false);
                location.reload();
                return;
              }
              setArmed(true);
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-[13px] rounded-lg flex items-center
              text-deck-dim hover:text-deck-text hover:bg-white/5 transition-all"
          >
            <RefreshCw size={12} />
            <span className="text-left">
              {armed
                ? (broadcasting ? 'Tap again — this ends the live broadcast' : 'Tap again to reload')
                : (broadcasting ? 'Refresh (ends the broadcast)' : 'Refresh')}
            </span>
          </button>
        </div>
      )}

      {/* FAB bubble */}
      <button
        onClick={() => setOpen(prev => !prev)}
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-haspopup="menu"
        className="relative z-50 w-12 h-12 rounded-full shadow-xl
          flex items-center justify-center
          transition-all duration-100 active:scale-90
          bg-deck-accent/20 border border-deck-accent/30
          text-deck-accent hover:bg-deck-accent/30
          backdrop-blur-xl"
      >
        <Navigation size={20} />
      </button>
    </div>
  );
}
