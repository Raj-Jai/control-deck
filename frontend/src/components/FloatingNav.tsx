import { useState, useCallback } from 'react';
import { Navigation, Check } from 'lucide-react';

interface FloatingNavProps {
  pages: readonly { id: string; label: string }[];
  currentPage: number;
  scrollTo: (index: number) => void;
  autoFocus: boolean;
  onToggleAutoFocus: () => void;
}

export default function FloatingNav({ pages, currentPage, scrollTo, autoFocus, onToggleAutoFocus }: FloatingNavProps) {
  const [open, setOpen] = useState(false);

  const handleNav = useCallback((i: number) => {
    scrollTo(i);
    setOpen(false);
  }, [scrollTo]);

  return (
    <div className="fixed bottom-16 right-3 z-50">
      {/* Backdrop overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Menu */}
      {open && (
        <div
          className="absolute bottom-full right-0 mb-3 min-w-[180px] z-50
            bg-deck-bg/95 backdrop-blur-xl border border-white/[0.08] rounded-xl p-2 shadow-2xl
            animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="flex flex-col gap-0.5">
            {pages.map((p, i) => (
              <button
                key={p.id}
                onClick={() => handleNav(i)}
                className={`px-3 py-2 text-[12px] rounded-lg text-left transition-all ${
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
            onClick={onToggleAutoFocus}
            className="w-full flex items-center justify-between px-3 py-2 text-[12px] rounded-lg
              text-deck-dim hover:text-deck-text hover:bg-white/5 transition-all"
          >
            <span>Auto-focus</span>
            <span className={`w-4 h-4 rounded flex items-center justify-center transition-colors ${
              autoFocus ? 'bg-deck-accent' : 'border border-white/20'
            }`}>
              {autoFocus && <Check size={12} className="text-white" strokeWidth={3} />}
            </span>
          </button>
        </div>
      )}

      {/* FAB bubble */}
      <button
        onClick={() => setOpen(prev => !prev)}
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
