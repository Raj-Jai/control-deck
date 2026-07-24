import { useState } from 'react';
import PlayerCarousel from '../components/PlayerCarousel';
import { triggerCommand } from '../services/apiService';
import type { MediaState } from '../hooks/useMediaStream';
import type { Capabilities } from '../hooks/useCapabilities';

interface Props { state: MediaState | null; caps: Capabilities }

const aspects = ['Default', '16:9', '4:3', '21:9', '3:2'];

export default function VideoPlayerDeck({ state, caps }: Props) {
  const [subDelay, setSubDelay] = useState(0);
  const [audioDelay, setAudioDelay] = useState(0);

  return (
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

      <div className="deck-card p-3">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-0.5 h-3.5 rounded-full bg-deck-accent/30" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-deck-muted/60">Sync & Ratio</span>
          <div className="flex-1 h-px bg-white/[0.04]" />
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-deck-muted">Subtitle delay: {subDelay > 0 ? `+${subDelay}` : subDelay}s</label>
            <input type="range" min="-10" max="10" step="0.5" value={subDelay}
              onChange={e => setSubDelay(Number(e.target.value))}
              onMouseUp={() => triggerCommand(`sub_delay_${subDelay}`)}
              className="w-full" />
          </div>
          <div>
            <label className="text-[11px] text-deck-muted">Audio delay: {audioDelay > 0 ? `+${audioDelay}` : audioDelay}s</label>
            <input type="range" min="-10" max="10" step="0.5" value={audioDelay}
              onChange={e => setAudioDelay(Number(e.target.value))}
              onMouseUp={() => triggerCommand(`audio_delay_${audioDelay}`)}
              className="w-full" />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-3">
          {aspects.map(a => (
            <button key={a} onClick={() => triggerCommand(`aspect_${a}`)}
              className="px-2.5 py-1 text-[11px] rounded-md bg-white/5 border border-white/5
                text-deck-dim hover:text-deck-accent hover:border-deck-accent/30 active:scale-90">
              {a}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
