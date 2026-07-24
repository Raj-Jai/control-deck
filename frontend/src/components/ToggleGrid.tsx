import {
  Bluetooth,
  Lock,
  GraduationCap,
  Shield,
  Headphones,
  type LucideIcon,
} from 'lucide-react';
import { DECK_CONFIG } from '../config/deckConfig';
import type { MediaState } from '../hooks/useMediaStream';
import type { ToggleConfig } from '../config/deckConfig';
import { useCapabilities } from '../hooks/useCapabilities';
import { triggerCommand } from '../services/apiService';

interface ToggleGridProps {
  state: MediaState | null;
}

const iconMap: Record<string, LucideIcon> = {
  Bluetooth,
  Lock,
  GraduationCap,
  Shield,
};

function createRipple(
  e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
  el: HTMLElement
) {
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.2;
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  const x = clientX - rect.left - size / 2;
  const y = clientY - rect.top - size / 2;
  const ripple = document.createElement('span');
  ripple.className = 'toggle-ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

function renderIcon(iconName: string, size = 22) {
  const Icon = iconMap[iconName];
  return Icon ? <Icon size={size} /> : null;
}

/** Determine if a state toggle is active based on its id */
function isToggleActive(id: string, state: MediaState | null): boolean {
  if (!state) return false;
  switch (id) {
    case 'bt':
      return state.bluetooth_on;
    case 'warp':
      return state.warp_on;
    default:
      return false;
  }
}

export default function ToggleGrid({ state }: ToggleGridProps) {
  const { toggles } = DECK_CONFIG;
  const caps = useCapabilities();

  const visible = toggles.filter(t => !t.cap || caps[t.cap as keyof typeof caps]);

  const handleClick = (cfg: ToggleConfig, el: HTMLElement) => {
    if (cfg.cmd) {
      triggerCommand(cfg.cmd);
    } else if (cfg.cmdOn && cfg.cmdOff) {
      const active = isToggleActive(cfg.id, state);
      triggerCommand(active ? cfg.cmdOff : cfg.cmdOn);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-3">
      {visible.map((cfg) => {
        const active = !cfg.cmd && isToggleActive(cfg.id, state);
        return (
          <div
            key={cfg.id}
            className={`toggle-card ${active ? 'active' : ''}`}
            onMouseDown={(e) => createRipple(e, e.currentTarget)}
            onTouchStart={(e) => createRipple(e, e.currentTarget)}
            onClick={() => {
              const el = document.querySelector(`[data-id="${cfg.id}"]`) as HTMLElement;
              handleClick(cfg, el ?? document.body);
            }}
          >
            <span className="text-[28px] leading-none">{renderIcon(cfg.icon)}</span>
            <span className="toggle-label text-xs font-semibold text-deck-dim text-center leading-tight">
              {cfg.label}
            </span>

            {/* Bluetooth connect button */}
            {cfg.id === 'bt' && (
              <button
                className="absolute bottom-1 right-1 w-7 h-7 rounded-full flex items-center justify-center
                  bg-deck-surface2 border border-white/10 text-deck-dim text-[11px]
                  hover:bg-deck-accent hover:text-white hover:border-deck-accent
                  transition-all duration-100 z-[2] active:scale-85"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerCommand('btConnect');
                }}
                title="Connect headphone"
              >
                <Headphones size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
