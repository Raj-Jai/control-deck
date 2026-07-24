import StepperControls from '../components/StepperControls';
import ToggleGrid from '../components/ToggleGrid';
import CaffeineCard from '../components/CaffeineCard';
import AppMixerCard from '../components/AppMixerCard';
import CommandLogCard from '../components/CommandLogCard';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

export default function DefaultDeck({ state, caps }: Props) {
  return (
    <>
      {/* LEFT - Audio + Mixer */}
      <div className="flex flex-col gap-4">
        {state && (
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Audio</span>
              <div className="flex-1 h-px bg-white/[0.04]" />
            </div>
            <StepperControls state={state} caps={caps} />
          </div>
        )}
        <AppMixerCard streams={state?.app_streams ?? []} />
      </div>

      {/* RIGHT - Toggles + Utilities */}
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Quick Actions</span>
            <div className="flex-1 h-px bg-white/[0.04]" />
          </div>
          <ToggleGrid state={state} />
        </div>
        {caps.caffeine && <CaffeineCard state={state} />}
        <CommandLogCard log={state?.cmd_log ?? []} />
      </div>
    </>
  );
}
