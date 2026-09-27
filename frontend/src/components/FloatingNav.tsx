import { useState, useCallback } from 'react';
import { Navigation, Check, RefreshCw } from 'lucide-react';

interface FloatingNavProps {
  pages: readonly { id: string; label: string }[];
  currentPage: number;
  scrollTo: (index: number) => void;
  autoFocus: boolean;
  onToggleAutoFocus: () => void;
  /** Retained for callers that still pass it; the button is docked in the
   *  bottom strip now, so it no longer floats over the page. */
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
    // Docked in the bottom strip rather than floating over the page. It used to
    // be a fixed FAB at right-3, which meant it sat on top of whatever card
    // happened to be scrolled underneath it - on the Home deck it landed across
    // the mixer and the "More controls" button, which read as a rendering fault
    // rather than a deliberate control.
    <div className="relative shrink-0">
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
            bg-deck-bg/95 backdrop-blur-xl border border-deck-hairline/10 rounded-xl p-2 shadow-2xl"
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
                    : 'text-deck-dim hover:text-deck-text hover:bg-deck-surface-2'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-px bg-deck-surface-2 my-1.5" />

          <button
            role="menuitem"
            onClick={onToggleAutoFocus}
            className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] text-[13px] rounded-lg flex items-center
              text-deck-dim hover:text-deck-text hover:bg-deck-surface-2 transition-all"
          >
            <span>Auto-focus</span>
            <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
              autoFocus ? 'bg-deck-accent' : 'border border-deck-hairline/15'
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
              text-deck-dim hover:text-deck-text hover:bg-deck-surface-2 transition-all"
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
