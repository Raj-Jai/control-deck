import { useRef, useState, useEffect } from 'react';
import ValueSlider from './ValueSlider';
import { Volume2, VolumeX, Moon, Speaker, Headphones, Music } from 'lucide-react';
import type { MediaState, AppStreamInfo } from '../hooks/useMediaStream';
import { triggerCommand, setVolume, setBrightness, setDefaultSink, sliderToValue, valueToSlider } from '../services/apiService';

interface MixerCardProps {
  state: MediaState | null;
  caps: Record<string, boolean>;
}

// One column template for every audio row in the card: leading cell, slider,
// readout, trailing control. The master rows and the per-app rows used to have
// different structures - the master rows led with a 36px icon and had an
// optional trailing button, the app rows led with a flexible label and had a
// mute button in the middle - so the sliders started at different x positions,
// the readouts did not line up, and the volume row carried a button at the end
// that the brightness row did not. Sharing the template lines all of it up.
const ROW = 'grid grid-cols-[88px_minmax(0,1fr)_40px_40px] items-center gap-2.5 sm:grid-cols-[92px_minmax(0,1fr)_44px_40px]';

export default function MixerCard({ state, caps }: MixerCardProps) {
  const vol = state?.volume ?? -1;
  const muted = state?.muted ?? false;
  const bri = state?.brightness ?? -1;
  const nightOn = state?.night_light ?? false;
  const sinks = state?.sinks ?? [];
  // A negative volume or brightness is how the host reports "I could not read
  // this", not a reading of zero. Without a sink there is nothing to control.
  const hasAudio = vol >= 0 || sinks.length > 0;

  // The master controls. Both were hand-rolled copies of the same
  // drag-throttle-commit logic, and the copies had drifted - one of them
  // cleared its dragging flag on pointerup but not on keyup, so a keyboard
  // user's slider showed its own value instead of the host's for the rest of
  // the session. One shared component now, with one behaviour.
  const showVol = vol >= 0 ? Math.round(valueToSlider(vol, 1) * 100) : 0;
  const showBri = bri >= 0 ? Math.round(valueToSlider(bri, 100)) : 0;

  const isBT = (s: AppStreamInfo & { id: number; name?: string; description?: string; default?: boolean }) =>
    /bluez/i.test((s as any).name ?? '');
  const btSink = sinks.find(isBT as any);
  const speakerSink = sinks.find(s => !isBT(s as any) && !/hdmi/i.test((s as any).description ?? ''));
  const activeSink = sinks.find(s => (s as any).default);
  const hasSinks = !!(btSink && speakerSink && activeSink);
  const activeIsBT = hasSinks && activeSink!.id === btSink!.id;

  const toggleSink = () => {
    if (!hasSinks) return;
    const target = activeIsBT ? speakerSink! : btSink!;
    setDefaultSink(target.id);
  };

  return (
    <div className="deck-card">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">
          Mixer
        </span>
        <div className="flex-1 h-px bg-deck-surface-2" />
      </div>

      <div className="flex flex-col gap-4">
        {/* Volume row. With no audio stack the controls looked identical to a
            working one, so a user dragged a slider that did nothing and had no
            way to tell (BUG-020). */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-deck-dim">
              Volume
            </span>
            {!hasAudio && (
              <span className="text-[10px] text-deck-warning/80">
                no audio output detected
              </span>
            )}
          </div>
          <div className={ROW}>
            <button
              className={`icon-btn w-9 h-9 ${muted ? 'bg-deck-danger/15 border-deck-danger/30 text-deck-danger' : ''}`}
              onClick={() => triggerCommand('mute')}
              disabled={!hasAudio}
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={hasAudio ? (muted ? 'Unmute' : 'Mute') : 'No audio output detected'}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <ValueSlider
              label="Volume"
              value={showVol}
              hostValue={vol >= 0 ? showVol : null}
              disabled={!hasAudio}
              toValue={(pct) => sliderToValue(pct / 100, 1)}
              onSend={setVolume}
            />
            <button onClick={toggleSink} aria-label={activeIsBT ? 'Switch audio output to the built-in speakers' : 'Switch audio output to the paired headset'}
              className="icon-btn w-9 h-9" disabled={!hasSinks} hidden={!hasSinks}
              title={hasSinks ? undefined : 'Only one audio output detected'}>
              {activeIsBT ? <Speaker size={16} /> : <Headphones size={16} />}
            </button>
          </div>
        </div>

        {/* Brightness row */}
        {caps.brightness && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-deck-dim mb-1.5">
              Brightness
            </div>
            <div className={ROW}>
              <button
                className={`icon-btn w-9 h-9 ${nightOn ? 'bg-deck-accent/15 border-deck-accent/30 text-deck-accent' : ''}`}
                onClick={() => triggerCommand(nightOn ? 'nightOff' : 'nightOn')}
                aria-label={nightOn ? 'Turn night light off' : 'Turn night light on'}
                aria-pressed={nightOn}
              >
                <Moon size={16} />
              </button>
              <ValueSlider
                label="Brightness"
                value={showBri}
                hostValue={bri >= 0 ? showBri : null}
                toValue={(pct) => sliderToValue(pct, 100)}
                onSend={setBrightness}
              />
              <span />
            </div>
          </div>
        )}

        {/* App audio streams */}
        {state?.app_streams && state.app_streams.length > 0 && (
          <AppStreamsList streams={state.app_streams} />
        )}
      </div>

    </div>
  );
}

export function AppStreamsList({ streams }: { streams: AppStreamInfo[] }) {
  const setStream = async (id: number, body: Record<string, unknown>) => {
    try {
      const res = await fetch('/api/audio/set-app-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      });
      // The shared slider reverts and explains when a send is refused, so the
      // status has to be reported rather than swallowed.
      return res.ok;
    } catch {
      return false;
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Music size={14} className="text-deck-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-deck-dim">
          App Audio
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {streams.map((s) => {
          const vol = s.volume;
          return (
            <div key={s.id} className={`${ROW} py-1.5 px-2 rounded-lg bg-deck-surface-2`}>
              <div className="min-w-0">
                <div className="text-[11px] font-medium truncate">{s.app || 'Unknown'}</div>
                <div className="text-[10px] text-deck-dim truncate">
                  {s.media_name && s.media_name !== s.app ? s.media_name : `#${s.id}`}
                </div>
              </div>
              <ValueSlider
                label={`${s.media_name || s.app || `Stream ${s.id}`} volume`}
                value={vol}
                hostValue={vol}
                toValue={(pct) => pct}
                onSend={(v) => setStream(s.id, { volume: v })}
              />
              <span />
              <button
                className={`icon-btn w-8 h-8 ${s.muted ? 'bg-deck-danger/15 border-deck-danger/30 text-deck-danger' : ''}`}
                onClick={() => setStream(s.id, { muted: !s.muted })}
                aria-label={s.muted ? `Unmute ${s.media_name || `stream ${s.id}`}` : `Mute ${s.media_name || `stream ${s.id}`}`}
              >
                {s.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
