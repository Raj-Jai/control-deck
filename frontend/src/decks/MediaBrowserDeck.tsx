import PlayerCarousel from '../components/PlayerCarousel';
import StepperControls from '../components/StepperControls';
import { triggerCommand } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function MediaBrowserDeck({ state, caps }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {caps.playerctl && (
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
          <PlayerCarousel players={state?.players ?? []} />
          <div className="mt-3 flex justify-center items-center gap-1.5">
            <span className="text-[10px] text-deck-muted mr-1">Speed</span>
            {speeds.map(s => (
              <button key={s} onClick={() => triggerCommand(`speed_${s}`)}
                className="px-2 py-0.5 text-[11px] rounded-md bg-white/5 border border-white/5 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
                {s}x
              </button>
            ))}
          </div>
        </div>
      )}
      {state && (
        <div>
          {!caps.playerctl && (
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Audio</span>
              <div className="flex-1 h-px bg-white/[0.04]" />
            </div>
          )}
          <StepperControls state={state} caps={caps} />
        </div>
      )}
    </div>
  );
}
