import { useState, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, Monitor } from 'lucide-react';
import AuthScreen, { getStoredMode, clearAuth } from './components/AuthScreen';
import { useMediaStream } from './hooks/useMediaStream';
import { useCapabilities } from './hooks/useCapabilities';
import { useArtTheming } from './hooks/useArtTheming';
import { useActiveWindow, appToPageIndex } from './hooks/useActiveWindow';
import { setDeviceId } from './lib/streamManager';
import PlayerCarousel from './components/PlayerCarousel';
import MiniPlayer from './components/MiniPlayer';
import SystemStatsCard from './components/SystemStatsCard';
import ServiceStatsBar from './components/ServiceStatsBar';
import MixerCard from './components/MixerCard';
import QuickSettings from './components/QuickSettings';
import WeatherCard from './components/WeatherCard';
import CommandLogCard from './components/CommandLogCard';
import ClipboardCard from './components/ClipboardCard';
import ConnectedDevicesCard from './components/ConnectedDevicesCard';
import FloatingNav from './components/FloatingNav';
import MediaBrowserDeck from './decks/MediaBrowserDeck';
import VideoPlayerDeck from './decks/VideoPlayerDeck';
import IdeDeck from './decks/IdeDeck';
import TerminalDeck from './decks/TerminalDeck';
import MediaStreamerPage from './components/MediaStreamerPage';

const pages = [
  { id: 'home', label: 'Home' },
  { id: 'media', label: 'Media' },
  { id: 'video', label: 'Video' },
  { id: 'ide', label: 'Code' },
  { id: 'terminal', label: 'Terminal' },
] as const;

const PX_PER_PAGE = 36;

function getDeviceId(): string {
  try {
    let id = sessionStorage.getItem('dash_device_id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('dash_device_id', id);
    }
    return id;
  } catch {
    return '';
  }
}
const deviceId = getDeviceId();
if (deviceId) setDeviceId(deviceId);

export default function App() {
  const [authMode, setAuthMode] = useState<'dashboard' | 'media' | null>(getStoredMode);
  const { state, loading, error } = useMediaStream(deviceId);
  const { appType } = useActiveWindow();
  const caps = useCapabilities();
  useArtTheming(state?.art_url);
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);
  const [autoFocus, setAutoFocus] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [clientCount, setClientCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef(0);
  const dragStripRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const moveRAF = useRef(0);

  useEffect(() => {
    const cb = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cb);
    return () => document.removeEventListener('fullscreenchange', cb);
  }, []);

  useEffect(() => {
    const onInteraction = () => {
      document.documentElement.requestFullscreen().catch(() => {});
    };
    window.addEventListener('click', onInteraction, { once: true });
    window.addEventListener('touchstart', onInteraction, { once: true });
    window.addEventListener('keydown', onInteraction, { once: true });
    return () => {
      window.removeEventListener('click', onInteraction);
      window.removeEventListener('touchstart', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    };
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const scrollTo = (i: number, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const child = el.children[i] as HTMLElement | undefined;
    if (!child) return;
    child.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'start' });
    setPage(i);
  };

  useEffect(() => {
    if (!autoFocus || !appType) return;
    const target = appToPageIndex(appType);
    if (target !== page) scrollTo(target);
  }, [appType, autoFocus]);

  const handleScroll = () => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    scrollRAF.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setPage(idx);
    });
  };

  const showMini = page >= 3;

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/clients?device_id=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        setClientCount(data.count);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    const el = scrollRef.current;
    if (!el) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    el.style.scrollSnapType = 'none';
    dragState.current = { startX: e.clientX, startScrollLeft: el.scrollLeft };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    const ds = dragState.current;
    if (!ds) return;
    const el = scrollRef.current;
    if (!el) return;
    cancelAnimationFrame(moveRAF.current);
    moveRAF.current = requestAnimationFrame(() => {
      const dx = e.clientX - ds.startX;
      const pageWidth = el.clientWidth;
      const scrollDelta = dx * (pageWidth / PX_PER_PAGE);
      const maxScroll = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.max(0, Math.min(maxScroll, ds.startScrollLeft + scrollDelta));
    });
  };

  const onPointerUp = () => {
    cancelAnimationFrame(moveRAF.current);
    const el = scrollRef.current;
    dragState.current = null;
    setDragging(false);
    if (!el) return;
    el.style.scrollSnapType = '';
    const target = Math.round(el.scrollLeft / el.clientWidth);
    scrollTo(target, true);
  };

  if (!authMode) return <AuthScreen onAuth={setAuthMode} />;
  if (authMode === 'media') return <MediaStreamerPage deviceId={deviceId} />;

  return (
    <>
      <div className={`min-h-[100dvh] flex flex-col relative ${showMini ? 'pb-[6.5rem]' : 'pb-14'}`}>
        <button
          onClick={toggleFull}
          className="fixed top-[30px] right-3 z-50 w-10 h-10 rounded-lg flex items-center justify-center
            bg-black/40 backdrop-blur border border-white/10 text-deck-dim
            hover:bg-deck-accent/20 hover:text-deck-accent hover:border-deck-accent/30
            transition-all duration-100 active:scale-90"
          title={full ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        {/* Service process stats bar */}
        <div className="fixed top-0 left-0 right-0 z-50 flex justify-center bg-deck-bg/80 backdrop-blur-md border-b border-white/[0.06] pt-[env(safe-area-inset-top)]">
          <div className="w-full max-w-6xl mx-auto px-3 sm:px-4">
            <ServiceStatsBar />
          </div>
        </div>

        <div className="flex-1 w-full max-w-6xl mx-auto relative">
          {loading && (
            <div className="text-center text-deck-dim text-sm py-4">Connecting…</div>
          )}
          {error && (
            <div className="text-center text-red-400 text-sm py-2 mb-2">{error} — retrying…</div>
          )}

          {/* Now Playing — full on Home/Media/Video, mini on Code/Terminal */}
          {state && caps.playerctl && !showMini && (
            <div className="px-3 sm:px-4 md:px-5 lg:px-6 pt-3 pb-2">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <PlayerCarousel players={state?.players ?? []} state={state} />
            </div>
          )}

          {/* Swipeable pages */}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className={`flex overflow-x-auto no-scrollbar h-full ${
              dragging ? '' : 'snap-x snap-mandatory scroll-smooth'
            }`}
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Page 0: Home */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_340px] gap-4 md:gap-5 lg:gap-6">
                {/* LEFT */}
                <div className="flex flex-col gap-4 min-w-0">
                  <MixerCard state={state} caps={caps} />
                </div>

                {/* RIGHT */}
                <div className="flex flex-col gap-4 min-w-0">
                  <QuickSettings state={state} />
                  <ConnectedDevicesCard />
                  <WeatherCard />
                  <ClipboardCard />
                  <CommandLogCard log={state?.cmd_log ?? []} />
                </div>
              </div>

              <div className="mt-4 mb-3">
                <SystemStatsCard state={state} />
              </div>
            </div>

            {/* Page 1: Media Browser */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-0">
              <MediaBrowserDeck state={state} caps={caps} />
            </div>

            {/* Page 2: Video Player */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-0">
              <VideoPlayerDeck state={state} caps={caps} />
            </div>

            {/* Page 3: IDE */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-0">
              <IdeDeck caps={caps} />
            </div>

            {/* Page 4: Terminal */}
            <div className="snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-0">
              <TerminalDeck caps={caps} />
            </div>
          </div>
        </div>

      </div>

      {/* Mini player — docked above nav strip on Code/Terminal decks */}
      {showMini && state && caps.playerctl && <MiniPlayer state={state} />}

      {/* Bottom strip — fixed to bottom of screen */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-deck-bg/70 backdrop-blur-md border-t border-white/[0.04] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 md:px-5 lg:px-6 py-2 relative">
          {/* Draggable page dots */}
          <div
            ref={dragStripRef}
            className="flex items-center justify-center gap-6 select-none touch-none py-2 -my-2 w-full transition-transform duration-100"
            data-dragging={dragging || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {pages.map((p, i) => (
              <span
                key={p.id}
                className={`block rounded-full transition-all duration-200 ${
                  dragging
                    ? 'bg-white/40 w-3 h-3'
                    : i === page
                      ? 'bg-deck-accent w-6 h-2'
                      : 'bg-white/20 w-2 h-2'
                }`}
              />
            ))}
          </div>
          {clientCount > 0 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[10px] text-deck-muted/40 select-none pointer-events-none">
              <Monitor size={10} />
              {clientCount}
            </div>
          )}
        </div>
      </div>

      <FloatingNav
        pages={pages}
        currentPage={page}
        scrollTo={scrollTo}
        autoFocus={autoFocus}
        onToggleAutoFocus={() => setAutoFocus(prev => !prev)}
      />
    </>
  );
}
