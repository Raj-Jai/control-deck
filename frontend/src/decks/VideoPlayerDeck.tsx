import { useState, useEffect, useRef } from 'react';
import { fetchVideoStatus, sendVideoCommand, triggerCommand, setVolume, sliderToValue, valueToSlider } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';
import ValueSlider from '../components/ValueSlider';
import { Volume2, VolumeX, MonitorX } from 'lucide-react';

interface Props { state: MediaState | null; caps: Capabilities }

const aspects = ['Default', '16:9', '4:3', '21:9', '3:2', 'Crop Fill'];
const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];

function fmt(v: number): string {
  if (v === 0) return '0s';
  return (v > 0 ? '+' : '') + v.toFixed(1) + 's';
}

export default function VideoPlayerDeck({ state, caps }: Props) {
  const [vs, setVS] = useState<Awaited<ReturnType<typeof fetchVideoStatus>> | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [videoError, setVideoError] = useState('');
  const [audioDelay, setAudioDelay] = useState(0);
  const subRef = useRef(0);
  const audioRef = useRef(0);

  // A delay nudge is applied optimistically, but the 1 Hz poll will still be
  // carrying the player's *old* value for a round trip, and writing that back
  // made the displayed delay snap back and reset the ref the next nudge
  // computes from - so a second tap landed on the wrong value (SUS-012).
  //
  // While a nudge is in flight the poll's delay values are ignored. Once it
  // settles, the poll is authoritative again - and if the command failed the
  // real value takes over immediately, which is the honest outcome.
  const pendingDelay = useRef<'sub' | 'audio' | null>(null);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await fetchVideoStatus();
        if (dead) return;
        setVS(v);
        if (pendingDelay.current !== 'sub') {
          setSubDelay(v.sub_delay);
          subRef.current = v.sub_delay;
        }
        if (pendingDelay.current !== 'audio') {
          setAudioDelay(v.audio_delay);
          audioRef.current = v.audio_delay;
        }
      } catch { /* ignore */ }
      if (dead) return;
      // While hidden, stop scheduling; the visibilitychange listener restarts
      // it. The in-flight request still finishes, so the state is not torn down.
      if (document.visibilityState === 'visible') timer = setTimeout(poll, 1000);
    };
    poll();
    // The deck is only mounted while its page is on screen, so the poll is
    // already bounded by whether the user is looking at it. A hidden tab is the
    // other half: a backgrounded deck should not keep asking the player for
    // its status once a second, and on a laptop that means waking the radio.
    const onVisible = () => {
      if (!dead && document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      dead = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Applies a delay change, and reports whether the host accepted it.
  const applyDelay = async (kind: 'sub' | 'audio', value: number) => {
    const action = kind === 'sub' ? 'set_sub_delay' : 'set_audio_delay';
    const ref = kind === 'sub' ? subRef : audioRef;
    const next = Math.round(value * 10) / 10;

    // Optimistic, so the button feels immediate.
    ref.current = next;
    if (kind === 'sub') setSubDelay(next);
    else setAudioDelay(next);
    pendingDelay.current = kind;

    const ok = await sendVideoCommand(action, { value: next });
    if (pendingDelay.current === kind) pendingDelay.current = null;
    if (!ok) {
      // The host refused it, so the optimistic value is a lie. Drop back to
      // whatever the next poll reports rather than leaving it on screen.
      if (kind === 'sub') { setSubDelay(0); subRef.current = 0; }
      else { setAudioDelay(0); audioRef.current = 0; }
      setVideoError(`The player rejected that ${kind === 'sub' ? 'subtitle' : 'audio'} delay change.`);
    } else {
      setVideoError('');
    }
    return ok;
  };

  const nudge = (kind: 'sub' | 'audio', delta: number) => {
    const ref = kind === 'sub' ? subRef : audioRef;
    void applyDelay(kind, ref.current + delta);
  };

  const resetDelay = (kind: 'sub' | 'audio') => {
    void applyDelay(kind, 0);
  };

  const player = vs?.active_player ?? 'unknown';

  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const showVol = vol >= 0 ? Math.round(valueToSlider(vol, 1) * 100) : 0;

  // Every control on this deck injects keystrokes into whatever window has
  // focus. With no player detected that means a mis-tap types into the user's
  // editor, so nothing here may stay live.
  const noPlayer = player === 'unknown';

  if (noPlayer) {
    return (
      <div className="flex flex-col gap-4">
        <div className="deck-card flex flex-col items-center gap-3 text-center py-8 px-4">
          <MonitorX size={28} className="text-deck-dim" />
          <div>
            <p className="text-sm font-semibold text-deck-text">No video player detected</p>
            <p className="text-[12px] text-deck-dim mt-1 max-w-sm">
              These controls send keystrokes to the focused window, so they stay
              disabled until mpv or VLC is running. Open a video, then come back.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-deck-dim uppercase tracking-wider">Player:</span>
        <span className={`text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full border ${
          player === 'mpv' ? 'bg-blue-500/20 text-blue-300 border-blue-500/20' :
          'bg-orange-500/20 text-orange-300 border-orange-500/20'
        }`}>
          {player}
        </span>
      </div>

      {/* Volume Slider Card */}
      <div className="deck-card p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-deck-dim mb-2">
          Volume
        </div>
        <div className="flex items-center gap-2.5">
          <button
            className={`icon-btn w-9 h-9 text-base flex-shrink-0 ${
              muted ? 'bg-deck-danger/15 border-deck-danger/30 text-deck-danger' : 'text-deck-text'
            }`}
            onClick={() => triggerCommand('mute')}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <ValueSlider
            label="Volume"
            value={showVol}
            hostValue={vol >= 0 ? showVol : null}
            toValue={(pct) => sliderToValue(pct / 100, 1)}
            onSend={setVolume}
            className="flex-1"
          />
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Subtitles</span>
          <div className="flex-1 h-px bg-deck-surface-2" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => sendVideoCommand('cycle_subtitle', { direction: 'next' })}
            className="min-h-[44px] px-3 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
            Next
          </button>
          {vs?.subtitles?.length ? (
            <div className="flex flex-wrap gap-1.5 w-full">
              {vs.subtitles.map((t) => (
                <button
                  key={t.id}
                  onClick={() => sendVideoCommand('set_subtitle', { track_id: t.id })}
                  aria-pressed={t.active}
                  className={`min-h-[44px] min-w-[44px] px-2.5 rounded-md border text-[11px] ${
                    t.active
                      ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
                      : 'bg-deck-surface-2 border-deck-hairline/15 text-deck-dim hover:border-deck-accent/30'
                  }`}
                >
                  {t.title || `Track ${t.id}`}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-deck-dim">No subtitle tracks reported by the player</p>
          )}
          {videoError && (
            <span role="alert" className="text-[10px] text-deck-danger mr-1 max-w-[45%]">
              {videoError}
            </span>
          )}
          <div className="flex-1" />
          <button onClick={() => nudge('sub', -0.1)}
            className="w-11 h-11 rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">−</button>
          <span className="text-[11px] font-mono text-deck-accent min-w-[4ch] text-center tabular-nums">{fmt(subDelay)}</span>
          <button onClick={() => nudge('sub', 0.1)}
            className="w-11 h-11 rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">+</button>
          <button onClick={() => resetDelay('sub')}
            className="min-h-[44px] px-3 py-1.5 text-[11px] rounded bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90">Reset</button>
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Audio</span>
          <div className="flex-1 h-px bg-deck-surface-2" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => sendVideoCommand('cycle_audio', { direction: 'next' })}
            className="min-h-[44px] px-3 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
            Next
          </button>
          {vs?.audio_tracks?.length ? (
            <div className="flex flex-wrap gap-1.5 w-full">
              {vs.audio_tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => sendVideoCommand('set_audio', { track_id: t.id })}
                  aria-pressed={t.active}
                  className={`min-h-[44px] min-w-[44px] px-2.5 rounded-md border text-[11px] ${
                    t.active
                      ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent'
                      : 'bg-deck-surface-2 border-deck-hairline/15 text-deck-dim hover:border-deck-accent/30'
                  }`}
                >
                  {t.title || `Track ${t.id}`}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-deck-dim">No audio tracks reported by the player</p>
          )}
          <div className="flex-1" />
          <button onClick={() => nudge('audio', -0.1)}
            className="w-11 h-11 rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">−</button>
          <span className="text-[11px] font-mono text-deck-accent min-w-[4ch] text-center tabular-nums">{fmt(audioDelay)}</span>
          <button onClick={() => nudge('audio', 0.1)}
            className="w-11 h-11 rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90 flex items-center justify-center text-sm">+</button>
          <button onClick={() => resetDelay('audio')}
            className="min-h-[44px] px-3 py-1.5 text-[11px] rounded bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent active:scale-90">Reset</button>
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Aspect Ratio</span>
          <div className="flex-1 h-px bg-deck-surface-2" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {aspects.map(a => {
            const active = vs?.aspect_ratio != null && a.toLowerCase() === vs.aspect_ratio.toLowerCase();
            return (
              <button key={a} onClick={() => sendVideoCommand('set_aspect', { value: a })}
                className={`min-h-[44px] min-w-[44px] px-3 py-1.5 text-[11px] rounded-md border transition-all active:scale-90 ${
                  active
                    ? 'bg-deck-accent/20 border-deck-accent/40 text-deck-accent'
                    : 'bg-deck-surface-2 border-deck-hairline/15 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
                }`}>
                {a}
              </button>
            );
          })}
        </div>
      </div>

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Precision Playback</span>
          <div className="flex-1 h-px bg-deck-surface-2" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => sendVideoCommand('frame_step', { direction: 'prev' })}
            className="flex-1 min-h-[44px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90
              flex items-center justify-center gap-1.5">
            ◀ Frame Prev
          </button>
          <button onClick={() => sendVideoCommand('frame_step', { direction: 'next' })}
            className="flex-1 min-h-[44px] px-3 py-2 text-[11px] rounded-md bg-deck-surface-2 border border-deck-hairline/15
              text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90
              flex items-center justify-center gap-1.5">
            Frame Next ▶
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-deck-dim uppercase tracking-wider mr-1">Speed</span>
          <div className="flex flex-wrap gap-1.5">
            {speeds.map(s => {
              const active = vs?.speed != null && Math.abs(vs.speed - s) < 0.01;
              return (
                <button key={s} onClick={() => sendVideoCommand('set_speed', { value: s })}
                  className={`min-h-[44px] min-w-[44px] px-3 py-1.5 text-[11px] rounded-md border transition-all active:scale-90 ${
                    active
                      ? 'bg-deck-accent/20 border-deck-accent/40 text-deck-accent'
                      : 'bg-deck-surface-2 border-deck-hairline/15 text-deck-dim hover:text-deck-accent hover:border-deck-accent/30'
                  }`}>
                  {s}x
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
