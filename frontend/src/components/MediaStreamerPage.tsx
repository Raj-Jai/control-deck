import { Music, LogOut } from 'lucide-react';
import { useMediaStream } from '../hooks/useMediaStream';
import { useCapabilities } from '../hooks/useCapabilities';
import { useArtTheming } from '../hooks/useArtTheming';
import PlayerCarousel from './PlayerCarousel';
import ConnectedDevicesCard from './ConnectedDevicesCard';
import { AppStreamsList } from './MixerCard';
import { clearAuth } from './AuthScreen';

interface Props {
  deviceId: string;
}

export default function MediaStreamerPage({ deviceId }: Props) {
  const { state, loading, error } = useMediaStream(deviceId);
  const caps = useCapabilities();
  useArtTheming(state?.art_url);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[#0b0d12]">
      {/* Header */}
      <div className="sticky top-0 z-50 flex items-center gap-3 px-4 h-12 bg-deck-bg/80 backdrop-blur-md border-b border-white/[0.06]">
        <Music size={16} className="text-amber-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim">
          Media Streamer
        </span>
        <div className="flex-1" />
        <button
          onClick={() => { clearAuth(); location.reload(); }}
          className="icon-btn w-7 h-7 text-deck-dim hover:text-red-400"
          title="Lock & exit"
        >
          <LogOut size={13} />
        </button>
      </div>

      {/* Loading / error */}
      {loading && !state && (
        <div className="text-center text-deck-dim text-sm py-8">Connecting…</div>
      )}
      {error && (
        <div className="text-center text-red-400 text-sm py-2 px-4">{error}</div>
      )}

      <div className="flex-1 w-full max-w-3xl mx-auto px-3 sm:px-4 py-4 flex flex-col gap-4">
        {/* Now Playing */}
        {state && caps.playerctl && (
          <div className="deck-card">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-0.5 h-3.5 rounded-full bg-amber-500/40" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
                Now Playing
              </span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <PlayerCarousel players={state?.players ?? []} state={state} />
          </div>
        )}

        {/* App audio streams */}
        {state?.app_streams && state.app_streams.length > 0 && (
          <div className="deck-card">
            <div className="flex items-center gap-2.5 mb-2">
              <Music size={14} className="text-deck-accent" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-deck-muted/50">
                App Audio
              </span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <AppStreamsList streams={state.app_streams} />
          </div>
        )}

        <ConnectedDevicesCard />
      </div>
    </div>
  );
}
