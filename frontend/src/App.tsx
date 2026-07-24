import { useState, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import LockScreen from './components/LockScreen';
import { useMediaStream } from './hooks/useMediaStream';
import { useCapabilities } from './hooks/useCapabilities';
import { useArtTheming } from './hooks/useArtTheming';
import { useActiveWindow } from './hooks/useActiveWindow';
import PlayerCarousel from './components/PlayerCarousel';
import SystemStatsCard from './components/SystemStatsCard';
import MediaBrowserDeck from './decks/MediaBrowserDeck';
import VideoPlayerDeck from './decks/VideoPlayerDeck';
import IdeDeck from './decks/IdeDeck';
import TerminalDeck from './decks/TerminalDeck';
import DefaultDeck from './decks/DefaultDeck';
import type { Profile } from './hooks/useActiveWindow';

const profileDecks: Record<Profile, React.FC<{ state: any; caps: any }>> = {
  'media-browser': MediaBrowserDeck,
  'video-player': VideoPlayerDeck,
  'ide': IdeDeck,
  'terminal': TerminalDeck,
  'default': DefaultDeck,
};

const profileLabels: Record<Profile, string> = {
  'media-browser': 'Media Browser',
  'video-player': 'Video Player',
  'ide': 'Code Editor',
  'terminal': 'Terminal',
  'default': 'Dashboard',
};

export default function App() {
  const { state, loading, error } = useMediaStream();
  const caps = useCapabilities();
  useArtTheming(state?.art_url);
  const { profile, windowInfo } = useActiveWindow();
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

  const DeckComponent = profileDecks[profile];

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
            <div className="text-center text-deck-dim text-sm py-4">Connecting…</div>
          )}
          {error && (
            <div className="text-center text-red-400 text-sm py-2 mb-2">{error} — retrying…</div>
          )}

          {/* Profile indicator */}
          {profile !== 'default' && (
            <div className="flex items-center gap-2 mb-4 px-1">
              <span className="w-2 h-2 rounded-full bg-deck-accent/60 animate-pulse" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-deck-accent/80">
                {profileLabels[profile]}
              </span>
              {windowInfo?.title && (
                <span className="text-[10px] text-deck-dim truncate max-w-[200px]">
                  {windowInfo.title}
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 wide:grid-cols-[1fr_340px] gap-4 wide:gap-6">
            <DeckComponent state={state} caps={caps} />
          </div>
        </div>

        {/* Bottom strip — always visible */}
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 wide:px-6 pb-3 sm:pb-4 wide:pb-6">
          <SystemStatsCard state={state} />
        </div>
      </div>
    </LockScreen>
  );
}
