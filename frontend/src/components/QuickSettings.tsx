import { useState, useEffect } from 'react';
import { Coffee, Bluetooth, Lock, GraduationCap, Shield, Speaker, Headphones } from 'lucide-react';
import type { MediaState } from '../hooks/useMediaStream';
import { DECK_CONFIG } from '../config/deckConfig';
import { useCapabilities } from '../hooks/useCapabilities';
import { triggerCommand } from '../services/apiService';

interface QuickSettingsProps {
  state: MediaState | null;
}

const iconMap: Record<string, any> = {
  Bluetooth, Lock, GraduationCap, Shield, Speaker, Headphones, Coffee,
};

export default function QuickSettings({ state }: QuickSettingsProps) {
  const caps = useCapabilities();
  const { toggles } = DECK_CONFIG;
  const caffeineOn = state?.caffeine_on ?? false;
  const caffeineCustom = state?.caffeine_custom ?? false;
  const caffeineDuration = state?.caffeine_duration ?? 0;
  const [activeDuration, setActiveDuration] = useState<string | null>(null);

  useEffect(() => {
    if (!caffeineOn) {
      setActiveDuration(null);
    } else if (caffeineCustom) {
      if (caffeineDuration === 1800) setActiveDuration('30');
      else if (caffeineDuration === 3600) setActiveDuration('60');
      else setActiveDuration('inf');
    } else {
      setActiveDuration('inf');
    }
  }, [caffeineOn, caffeineCustom, caffeineDuration]);

  const handleCaffeine = (d: string) => {
    if (activeDuration === d && caffeineOn) {
      triggerCommand('caffeineOff');
    } else {
      const cmd = d === '30' ? 'caffeine30' : d === '60' ? 'caffeine60' : 'caffeineOn';
      triggerCommand(cmd);
    }
  };

  const isActive = (id: string): boolean => {
    if (!state) return false;
    switch (id) {
      case 'bt': return state.bluetooth_on;
      case 'btSink': return state.bt_sink_on;
      case 'warp': return state.warp_on;
      default: return false;
    }
  };

  const handleToggle = (cfg: typeof toggles[number]) => {
    if (cfg.cmd) {
      triggerCommand(cfg.cmd);
    } else if (cfg.cmdOn && cfg.cmdOff) {
      triggerCommand(isActive(cfg.id) ? cfg.cmdOff : cfg.cmdOn);
    }
  };

  const visibleToggles = toggles.filter(t => !t.cap || caps[t.cap as keyof typeof caps]);

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          Quick Settings
        </span>
        <div className="flex-1 h-px bg-white/[0.04]" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Caffeine row — rendered as 3 toggle-sized buttons */}
        {caps.caffeine && (
          <>
            <QuickToggle
              icon={Coffee} label="30m"
              active={activeDuration === '30'}
              onClick={() => handleCaffeine('30')}
            />
            <QuickToggle
              icon={Coffee} label="1h"
              active={activeDuration === '60'}
              onClick={() => handleCaffeine('60')}
            />
            <QuickToggle
              icon={Coffee} label="∞"
              active={activeDuration === 'inf'}
              onClick={() => handleCaffeine('inf')}
            />
          </>
        )}

        {/* Dynamic toggles from DECK_CONFIG — Stream button excluded (in NowPlayingCard) */}
        {visibleToggles.filter(t => t.id !== 'audioStream').map(cfg => {
          const active = !cfg.cmd && isActive(cfg.id);
          const Icon = iconMap[cfg.icon] || null;
          return (
            <QuickToggle
              key={cfg.id}
              icon={Icon}
              label={cfg.label}
              active={active}
              onClick={() => handleToggle(cfg)}
              badge={cfg.id === 'bt' ? (
                <button
                  className="absolute bottom-0.5 right-0.5 w-6 h-6 rounded-full flex items-center justify-center
                    bg-deck-surface2 border border-white/10 text-deck-dim hover:bg-deck-accent hover:text-white
                    transition-all active:scale-85"
                  onClick={(e) => { e.stopPropagation(); triggerCommand('btConnect'); }}
                  title="Connect headphone"
                >
                  <Headphones size={11} />
                </button>
              ) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

interface QuickToggleProps {
  icon: any;
  label: string;
  active?: boolean;
  pulse?: boolean;
  onClick: () => void;
  badge?: React.ReactNode;
  customClass?: string;
}

function QuickToggle({ icon: Icon, label, active, pulse, onClick, badge, customClass }: QuickToggleProps) {
  return (
    <div
      className={`toggle-card relative ${active ? 'active' : ''} ${customClass || ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-pressed={active ?? false}
    >
      <span className={`text-[22px] leading-none ${pulse ? 'animate-pulse' : ''}`}>
        {Icon ? <Icon size={22} /> : null}
      </span>
      <span className="toggle-label text-[10px] font-semibold text-center leading-tight">
        {label}
      </span>
      {badge}
    </div>
  );
}
