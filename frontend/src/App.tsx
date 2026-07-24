import { useState, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight } from 'lucide-react';
import LockScreen from './components/LockScreen';
import { useMediaStream } from './hooks/useMediaStream';
import { useCapabilities } from './hooks/useCapabilities';
import { useArtTheming } from './hooks/useArtTheming';
import { useActiveWindow } from './hooks/useActiveWindow';
import PlayerCarousel from './components/PlayerCarousel';
import SystemStatsCard from './components/SystemStatsCard';
import StepperControls from './components/StepperControls';
import ToggleGrid from './components/ToggleGrid';
import CaffeineCard from './components/CaffeineCard';
import AppMixerCard from './components/AppMixerCard';
import CommandLogCard from './components/CommandLogCard';
import ClipboardCard from './components/ClipboardCard';
import AudioStreamCard from './components/AudioStreamCard';
import MediaBrowserDeck from './decks/MediaBrowserDeck';
import VideoPlayerDeck from './decks/VideoPlayerDeck';
import IdeDeck from './decks/IdeDeck';
import TerminalDeck from './decks/TerminalDeck';

const pages = [
  { id: 'home', label: 'Home' },
  { id: 'media', label: 'Media' },
  { id: 'video', label: 'Video' },
  { id: 'ide', label: 'Code' },
  { id: 'terminal', label: 'Terminal' },
] as const;

const browserClasses = ['chromium', 'firefox', 'google-chrome', 'brave', 'mozilla'];

function isMediaFocus(appClass: string): boolean {
  return browserClasses.some(c => appClass.toLowerCase().includes(c));
}

export default function App() {
  const { state, loading, error } = useMediaStream();
  const { windowInfo } = useActiveWindow();
  const caps = useCapabilities();
  useArtTheming(state?.art_url);
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const scrollTo = (i: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const child = el.children[i] as HTMLElement;
    if (child) child.scrollIntoView({ behavior: 'smooth', inline: 'start' });
    setPage(i);
  };

  // Auto-navigate based on active window focus
  useEffect(() => {
    if (!windowInfo) return;
    const target = isMediaFocus(windowInfo.app_class) ? 1 : 0;
    if (target !== page) scrollTo(target);
  }, [windowInfo?.app_class, windowInfo?.title]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setPage(idx);
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

        {/* Page indicator */}
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5">
          {pages.map((p, i) => (
            <button
              key={p.id}
              onClick={() => scrollTo(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
                i === page
                  ? 'bg-deck-accent w-4'
                  : 'bg-white/20 hover:bg-white/40'
              }`}
              aria-label={p.label}
            />
          ))}
        </div>

        <div className="flex-1 w-full max-w-6xl mx-auto relative">
          {loading && (
            <div className="text-center text-deck-dim text-sm py-4">Connecting…</div>
          )}
          {error && (
            <div className="text-center text-red-400 text-sm py-2 mb-2">{error} — retrying…</div>
          )}

          {/* Swipeable pages */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth
              no-scrollbar h-full"
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Page 0: Home */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 wide:p-6 pb-0">
              <div className="grid grid-cols-1 wide:grid-cols-[1fr_340px] gap-4 wide:gap-6">
                {/* LEFT */}
                <div className="flex flex-col gap-4">
                  {caps.playerctl && (
                    <div>
                      <div className="flex items-center gap-2.5 mb-1">
                        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
                        <div className="flex-1 h-px bg-white/[0.04]" />
                      </div>
                      <PlayerCarousel players={state?.players ?? []} />
                    </div>
                  )}
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

                {/* RIGHT */}
                <div className="flex flex-col gap-4">
                  {caps.caffeine && <CaffeineCard state={state} />}
                  <AudioStreamCard state={state} />
                  <div>
                    <div className="flex items-center gap-2.5 mb-1">
                      <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Quick Actions</span>
                      <div className="flex-1 h-px bg-white/[0.04]" />
                    </div>
                    <ToggleGrid state={state} />
                  </div>
                  <ClipboardCard />
                  <CommandLogCard log={state?.cmd_log ?? []} />
                </div>
              </div>

              <div className="mt-4 mb-3">
                <SystemStatsCard state={state} />
              </div>
            </div>

            {/* Page 1: Media Browser */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 wide:p-6 pb-0">
              <MediaBrowserDeck state={state} caps={caps} />
            </div>

            {/* Page 2: Video Player */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 wide:p-6 pb-0">
              <VideoPlayerDeck state={state} caps={caps} />
            </div>

            {/* Page 3: IDE */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 wide:p-6 pb-0">
              <IdeDeck state={state} caps={caps} />
            </div>

            {/* Page 4: Terminal */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 wide:p-6 pb-0">
              <TerminalDeck state={state} caps={caps} />
            </div>
          </div>
        </div>

        {/* Bottom strip */}
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 wide:px-6 pb-3 sm:pb-4 wide:pb-6">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => scrollTo(page - 1)}
              disabled={page === 0}
              className="flex items-center gap-1 text-[10px] text-deck-dim disabled:opacity-0
                hover:text-deck-accent transition-colors"
            >
              <ChevronLeft size={14} />
              {pages[page - 1]?.label ?? ''}
            </button>

            <span className="text-[10px] uppercase tracking-wider text-deck-muted/40 font-semibold">
              {pages[page].label}
            </span>

            <button
              onClick={() => scrollTo(page + 1)}
              disabled={page === pages.length - 1}
              className="flex items-center gap-1 text-[10px] text-deck-dim disabled:opacity-0
                hover:text-deck-accent transition-colors"
            >
              {pages[page + 1]?.label ?? ''}
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </LockScreen>
  );
}
