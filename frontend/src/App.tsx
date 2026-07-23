import { useMediaStream } from './hooks/useMediaStream';
import NowPlayingCard from './components/NowPlayingCard';
import StepperControls from './components/StepperControls';
import ToggleGrid from './components/ToggleGrid';
import CaffeineCard from './components/CaffeineCard';
import SystemStatsCard from './components/SystemStatsCard';
import ClipboardCard from './components/ClipboardCard';

export default function App() {
  const { state, loading, error } = useMediaStream();

  return (
    <div className="min-h-screen p-3 sm:p-6 flex items-start justify-center">
      <div className="w-full max-w-[900px]">
        {loading && (
          <div className="text-center text-deck-dim text-sm py-4">
            Connecting…
          </div>
        )}

        {error && (
          <div className="text-center text-red-400 text-sm py-2 mb-2">
            {error} — retrying…
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Left column */}
          <div className="flex flex-col gap-3">
            <NowPlayingCard state={state} />
            <StepperControls state={state} />
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-3">
            <ToggleGrid state={state} />
            <CaffeineCard state={state} />
            <ClipboardCard />
            <SystemStatsCard state={state} />
          </div>
        </div>
      </div>
    </div>
  );
}
