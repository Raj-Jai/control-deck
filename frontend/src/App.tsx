import { useState, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import LockScreen from './components/LockScreen';
import { useMediaStream } from './hooks/useMediaStream';
import { useCapabilities } from './hooks/useCapabilities';
import { useArtTheming } from './hooks/useArtTheming';
import PlayerCarousel from './components/PlayerCarousel';
import StepperControls from './components/StepperControls';
import ToggleGrid from './components/ToggleGrid';
import CaffeineCard from './components/CaffeineCard';
import AppMixerCard from './components/AppMixerCard';
import SystemStatsCard from './components/SystemStatsCard';
import ClipboardCard from './components/ClipboardCard';
import CommandLogCard from './components/CommandLogCard';

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-1">
      <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
        {label}
      </span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  );
}

export default function App() {
  const { state, loading, error } = useMediaStream();
  const caps = useCapabilities();
  useArtTheming(state?.art_url);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const cb = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cb);
    return () => document.removeEventListener('fullscreenchange', cb);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  return (
    <LockScreen>
      <div className="min-h-[100dvh] flex flex-col relative">
        <button
          onClick={toggleFull}
          className="fixed top-3 right-3 z-50 w-8 h-8 rounded-lg flex items-center justify-center
            bg-black/40 backdrop-blur border border-white/10 text-deck-dim
            hover:bg-deck-accent/20 hover:text-deck-accent hover:border-deck-accent/30
            transition-all duration-100 active:scale-90"
          title={full ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <div className="flex-1 w-full max-w-6xl mx-auto p-3 sm:p-4 wide:p-6">
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

          <div className="grid grid-cols-1 wide:grid-cols-[1fr_340px] gap-4 wide:gap-6">
            {/* ── LEFT COLUMN — Audio Zone ── */}
            <div className="flex flex-col gap-4">
              {caps.playerctl && (
                <div>
                  <SectionDivider label="Now Playing" />
                  <PlayerCarousel players={state?.players ?? []} />
                </div>
              )}

              {state && (
                <div>
                  {!caps.playerctl && <SectionDivider label="Audio" />}
                  <StepperControls state={state} caps={caps} />
                </div>
              )}

              <div>
                <AppMixerCard streams={state?.app_streams ?? []} />
              </div>
            </div>

            {/* ── RIGHT COLUMN — Controls & Utilities ── */}
            <div className="flex flex-col gap-4">
              <div>
                <SectionDivider label="Quick Actions" />
                <ToggleGrid state={state} />
              </div>

              {caps.caffeine && <CaffeineCard state={state} />}
              {caps.clipboard && <ClipboardCard />}
              <CommandLogCard log={state?.cmd_log ?? []} />
            </div>
          </div>
        </div>

        {/* ── BOTTOM STRIP — System Metrics ── */}
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 wide:px-6 pb-3 sm:pb-4 wide:pb-6">
          <SystemStatsCard state={state} />
        </div>
      </div>
    </LockScreen>
  );
}
