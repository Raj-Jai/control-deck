import { useState, useEffect, useMemo, useRef } from 'react';
import { Maximize2, Minimize2, Monitor, ChevronDown, ChevronUp } from 'lucide-react';
import AuthScreen, { getStoredMode } from './components/AuthScreen';
import { useMediaStream } from './hooks/useMediaStream';
import { useCapabilities } from './hooks/useCapabilities';
import { useFeatureFlags } from './hooks/useFeatures';
import type { FeatureKey } from './config/features';
import { useArtTheming } from './hooks/useArtTheming';
import { useActiveWindow, appToPageIndex } from './hooks/useActiveWindow';
import { setDeviceId } from './lib/streamManager';
import { getOrCreateDeviceId } from './lib/deviceId';
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
import GeoSurveyCard from './components/GeoSurveyCard';
import BleProximityCard from './components/BleProximityCard';
import FileDropCard from './components/FileDropCard';
import ScenesCard from './components/ScenesCard';

type PageId = 'home' | 'media' | 'video' | 'ide' | 'terminal';
interface DeckPage { id: PageId; label: string; flag: FeatureKey | null }

const ALL_PAGES: readonly DeckPage[] = [
  { id: 'home', label: 'Home', flag: null },
  { id: 'media', label: 'Media', flag: 'media_browser' },
  { id: 'video', label: 'Video', flag: 'video_player' },
  { id: 'ide', label: 'Code', flag: 'ide' },
  { id: 'terminal', label: 'Terminal', flag: 'terminal' },
];

const CLIENT_POLL_MS = 5000;

const deviceId = getOrCreateDeviceId();
if (deviceId) setDeviceId(deviceId);

export default function App() {
  const [authMode, setAuthMode] = useState<'dashboard' | 'media' | null>(getStoredMode);

  // Every one of these opens a connection or polls. While the page is locked
  // they would all be refused (and were, before the session existed), so a
  // locked page now consumes no server resources and receives no state.
  const unlocked = authMode !== null;
  const { state, loading, error } = useMediaStream(deviceId, unlocked);
  const { appType } = useActiveWindow(unlocked);
  const caps = useCapabilities(unlocked);
  const [features, flagsReady] = useFeatureFlags(unlocked);
  useArtTheming(state?.art_url);
  const [full, setFull] = useState(false);
  const [page, setPage] = useState(0);
  const [autoFocus, setAutoFocus] = useState(true);
  const [dragging, setDragging] = useState(false);
  // Secondary Home cards stay collapsed between sessions: the deck used to
  // need up to six screens of scrolling, dominated by a niche GPS canvas.
  const [showMore, setShowMore] = useState(() => {
    try { return localStorage.getItem('dash_home_more') === '1'; } catch { return false; }
  });
  const [clientCount, setClientCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef(0);
  const dragStripRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const moveRAF = useRef(0);

  useEffect(() => {
    try { localStorage.setItem('dash_home_more', showMore ? '1' : '0'); } catch { /* private mode */ }
  }, [showMore]);

  useEffect(() => {
    const cb = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', cb);
    return () => document.removeEventListener('fullscreenchange', cb);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  // Visible pages shrink when deck flags are disabled. Home is always
  // present; its cards gate individually below.
  const pages = useMemo(
    () => ALL_PAGES.filter(p => p.flag === null || features[p.flag]),
    [features]
  );

  const scrollTo = (i: number, smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(pages.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
    // Deck switch resets vertical scroll — otherwise a scrolled-down page
    // leaves the new deck showing blank space below its content.
    // Skipped when re-tapping the active page so the user's scroll is kept.
    // Deferred by a frame: clicking a nav dot focuses it, and the browser's
    // own scroll-into-view runs after this handler, which is what used to dump
    // the user 200-350px down the page on every deck change.
    if (clamped !== page) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
    setPage(clamped);
  };

  // Auto-focus follows host app changes only — page/scrollTo omitted from
  // deps so manual navigation (dots/nav menu) is never yanked back.
  useEffect(() => {
    if (!autoFocus || !appType) return;
    const allTarget = ALL_PAGES[appToPageIndex(appType)];
    if (!allTarget) return;
    const visible = pages.findIndex(p => p.id === allTarget.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (visible >= 0 && visible !== page) scrollTo(visible);
  }, [appType, autoFocus]);

  // Clamp the current page when flags remove pages.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (page > pages.length - 1) scrollTo(pages.length - 1);
  }, [pages.length, page]);

  const handleScroll = () => {
    if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
    scrollRAF.current = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setPage(Math.max(0, Math.min(pages.length - 1, idx)));
    });
  };

  const currentPageId = pages[page]?.id;
  const showMini = currentPageId === 'ide' || currentPageId === 'terminal';

  // Inactive pages are clamped to viewport height. All deck pages share one
  // window scroll range, so without this the body stays as tall as the
  // tallest page and short decks end in a long scrollable void.
  const pageClass = (id: PageId) =>
    `snap-start shrink-0 w-full p-3 sm:p-4 md:p-5 lg:p-6 pb-12 ${
      currentPageId === id ? '' : 'h-[calc(100dvh-7rem)] overflow-hidden'
    }`;

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/clients?device_id=${encodeURIComponent(deviceId)}`);
        const data = await res.json();
        if (!cancelled) setClientCount(data.count);
      } catch {}
    };
    poll();
    const id = setInterval(poll, CLIENT_POLL_MS);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [unlocked]);

  // Deck-container drag. The carousel used to be mouse-inert: the pointer
  // handlers lived only on the bottom strip, so on desktop opening the FAB
  // menu was the only way to change decks.
  const deckDrag = useRef<{ startX: number; startY: number; startScrollLeft: number; engaged: boolean } | null>(null);

  const onDeckPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || e.pointerType === 'touch') return; // touch already scrubs natively
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    deckDrag.current = { startX: e.clientX, startY: e.clientY, startScrollLeft: el.scrollLeft, engaged: false };
  };

  const onDeckPointerMove = (e: React.PointerEvent) => {
    const ds = deckDrag.current;
    const el = scrollRef.current;
    if (!ds || !el) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.engaged) {
      // Claim the gesture only once it is unambiguously sideways, otherwise a
      // vertical scroll or a slider drag gets hijacked.
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) {
        if (Math.abs(dy) > 8) deckDrag.current = null;
        return;
      }
      ds.engaged = true;
      el.style.scrollSnapType = 'none';
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    cancelAnimationFrame(moveRAF.current);
    moveRAF.current = requestAnimationFrame(() => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.max(0, Math.min(maxScroll, ds.startScrollLeft - dx));
    });
  };

  const onDeckPointerUp = () => {
    const ds = deckDrag.current;
    deckDrag.current = null;
    if (!ds || !ds.engaged) return;
    const el = scrollRef.current;
    cancelAnimationFrame(moveRAF.current);
    setDragging(false);
    if (!el) return;
    el.style.scrollSnapType = '';
    scrollTo(Math.round(el.scrollLeft / el.clientWidth), true);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary) return;
    // The dots are real buttons. setPointerCapture on this container would
    // retarget their click to the strip, so taps would do nothing at all —
    // which is exactly how the dots ended up being indicators only.
    if ((e.target as HTMLElement).closest('button')) return;
    const el = scrollRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
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
      const maxScroll = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.max(0, Math.min(maxScroll, ds.startScrollLeft - dx));
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
        {/* Top strip. Owns the fullscreen control, so the two can never
            overlap: body already applies the top safe-area inset, so this must
            not add it again. */}
        <div className="sticky top-0 z-50 flex justify-center bg-deck-bg/80 backdrop-blur-md border-b border-white/[0.06]">
          <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 flex items-center gap-2">
            {features.service_stats ? (
              <div className="min-w-0 flex-1 overflow-x-auto no-scrollbar">
                <ServiceStatsBar />
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <button
              onClick={toggleFull}
              className="shrink-0 w-11 h-11 -my-0.5 rounded-lg flex items-center justify-center
                text-deck-dim hover:bg-deck-accent/20 hover:text-deck-accent
                transition-all duration-100 active:scale-90"
              title={full ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={full ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
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
          {features.now_playing && state && caps.playerctl && !showMini && (
            <div className="px-3 sm:px-4 md:px-5 lg:px-6 pt-3 pb-2">
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Now Playing</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              <PlayerCarousel players={state?.players ?? []} state={state} />
            </div>
          )}

          {/* Swipeable pages. Nothing mounts until the feature set is known:
              a deck that is about to be hidden must not start a PTY or take
              focus on the way in. */}
          {!flagsReady && (
            <div className="text-center text-deck-dim text-sm py-8">Loading…</div>
          )}
          {flagsReady && (
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onPointerDown={onDeckPointerDown}
            onPointerMove={onDeckPointerMove}
            onPointerUp={onDeckPointerUp}
            onPointerCancel={onDeckPointerUp}
            className={`flex overflow-x-auto no-scrollbar h-full ${
              dragging ? '' : 'snap-x snap-mandatory scroll-smooth'
            }`}
            style={{ scrollbarWidth: 'none' }}
          >
            {/* Page 0: Home — primary controls first, the rest behind a toggle */}
            <div className={pageClass('home')}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_340px] gap-4 md:gap-5 lg:gap-6">
                {/* PRIMARY: what a person reaches for daily */}
                <div className="flex flex-col gap-4 min-w-0">
                  {features.mixer && <MixerCard state={state} caps={caps} />}
                  {features.quick_settings && <QuickSettings state={state} />}
                </div>

                <div className="flex flex-col gap-4 min-w-0">
                  {features.system_stats && <SystemStatsCard state={state} />}
                  {features.connected_devices && <ConnectedDevicesCard />}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowMore(v => !v)}
                aria-expanded={showMore}
                aria-controls="home-secondary"
                className="mt-4 w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl
                  border border-white/[0.08] bg-white/[0.03] text-[12px] font-medium text-deck-dim
                  hover:bg-white/[0.06] hover:text-deck-text transition-colors"
              >
                {showMore ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showMore ? 'Fewer' : 'More controls'}
              </button>

              {showMore && (
              <div id="home-secondary"
                className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_340px] gap-4 md:gap-5 lg:gap-6">
                <div className="flex flex-col gap-4 min-w-0">
                  {features.power && <ScenesCard />}
                  {features.geo_survey && <GeoSurveyCard />}
                  {features.ble_proximity && <BleProximityCard />}
                </div>
                <div className="flex flex-col gap-4 min-w-0">
                  {features.weather && <WeatherCard />}
                  {features.filedrop && <FileDropCard />}
                  {features.clipboard && <ClipboardCard />}
                  {features.command_log && <CommandLogCard log={state?.cmd_log ?? []} />}
                </div>
              </div>
              )}
            </div>

            {/* Page: Media Browser */}
            {features.media_browser && (
            <div className={pageClass('media')}>
              <MediaBrowserDeck state={state} caps={caps} />
            </div>
            )}

            {/* Page: Video Player */}
            {features.video_player && (
            <div className={pageClass('video')}>
              <VideoPlayerDeck state={state} caps={caps} />
            </div>
            )}

            {/* Page: IDE */}
            {features.ide && (
            <div className={pageClass('ide')}>
              <IdeDeck caps={caps} />
            </div>
            )}

            {/* Page: Terminal */}
            {features.terminal && (
            <div className={pageClass('terminal')}>
              <TerminalDeck caps={caps} />
            </div>
            )}
          </div>
          )}
        </div>

      </div>

      {/* Mini player — docked above nav strip on Code/Terminal decks */}
      {features.now_playing && showMini && state && caps.playerctl && <MiniPlayer state={state} />}

      {/* Bottom strip — fixed to bottom of screen */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-deck-bg/70 backdrop-blur-md border-t border-white/[0.04] pb-[env(safe-area-inset-bottom)]">
        <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 md:px-5 lg:px-6 py-2 relative">
          {/* Draggable page dots */}
          <div
            ref={dragStripRef}
            className="flex items-center justify-center gap-6 select-none touch-none py-1 w-full transition-transform duration-100"
            data-dragging={dragging || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => scrollTo(i, true)}
                aria-label={`Go to ${p.label} deck`}
                aria-current={i === page ? 'page' : undefined}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <span
                  className={`block rounded-full transition-all duration-200 ${
                    dragging
                      ? 'bg-white/40 w-3 h-3'
                      : i === page
                        ? 'bg-deck-accent w-6 h-2'
                        : 'bg-white/20 w-2 h-2'
                  }`}
                />
              </button>
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
        raised={showMini}
        pages={pages}
        currentPage={page}
        scrollTo={scrollTo}
        autoFocus={autoFocus}
        onToggleAutoFocus={() => setAutoFocus(prev => !prev)}
      />
    </>
  );
}
