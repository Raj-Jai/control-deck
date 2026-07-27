import { useState, useEffect } from 'react';
import { Coffee } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { triggerCommand } from '../services/apiService';

interface CaffeineCardProps {
  state: MediaState | null;
}

type Duration = '30' | '60' | 'inf' | null;

export default function CaffeineCard({ state }: CaffeineCardProps) {
  const caffeineOn = state?.caffeine_on ?? false;
  const caffeineCustom = state?.caffeine_custom ?? false;
  const caffeineDuration = state?.caffeine_duration ?? 0;
  const [active, setActive] = useState<Duration>(null);

  // Derive active from live state
  useEffect(() => {
    if (!caffeineOn) {
      setActive(null);
    } else if (caffeineCustom) {
      if (caffeineDuration === 1800) setActive('30');
      else if (caffeineDuration === 3600) setActive('60');
      else setActive('inf');
    } else {
      setActive('inf');
    }
  }, [caffeineOn, caffeineCustom, caffeineDuration]);

  const handleClick = (d: Duration) => {
    if (active === d && caffeineOn) {
      triggerCommand('caffeineOff');
      setActive(null);
    } else {
      setActive(d);
      const cmd = d === '30' ? 'caffeine30' : d === '60' ? 'caffeine60' : 'caffeineOn';
      triggerCommand(cmd);
    }
  };

  const btn = (d: Duration, label: string) => {
    const isActive = active === d && caffeineOn;
    return (
      <button
        onClick={() => handleClick(d)}
        aria-pressed={isActive}
        className={`flex-1 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider
          border transition-all duration-100
          ${isActive
            ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent shadow-[0_0_10px_rgba(6,182,212,0.2)]'
            : 'bg-deck-surface2 border-white/5 text-deck-text hover:bg-deck-accent/10 hover:border-deck-accent/20'
          }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2 mb-2">
        <Coffee size={16} className="text-deck-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Caffeine
        </span>
      </div>
      <div className="flex gap-2">
        {btn('30', '30m')}
        {btn('60', '1h')}
        {btn('inf', '∞')}
      </div>
    </div>
  );
}
