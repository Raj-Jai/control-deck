export interface LyricLine {
  id: number;
  timeMs: number;
  text: string;
}

// [mm:ss.xx], [m:ss.xxx], [mm:ss] and [mm:ss.x] all occur in real files. The
// old pattern demanded exactly two minute digits and a mandatory fraction, so
// a file using single-digit minutes lost every line, and it read only the first
// tag on a line, so a repeated chorus lost every repeat (BUG-037).
const TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** One timestamp tag → milliseconds, or null if the fraction is out of range. */
function tagToMs(h: string, m: string, frac: string | undefined): number | null {
  const minutes = Number(h);
  const seconds = Number(m);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  if (seconds > 59) return null;
  let ms = 0;
  if (frac !== undefined && frac !== '') {
    // ".5" is 500ms, ".05" is 50ms, ".050" is 50ms.
    ms = Number(frac.padEnd(3, '0').slice(0, 3));
    if (!Number.isFinite(ms)) return null;
  }
  return (minutes * 60 + seconds) * 1000 + ms;
}

export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const result: LyricLine[] = [];

  const lines = lrcText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    TAG.lastIndex = 0;

    // Collect every leading timestamp on this line.
    const times: number[] = [];
    let text = line;
    for (let guard = 0; guard < 64; guard++) {
      TAG.lastIndex = text.indexOf('[') === 0 ? 0 : -1;
      if (TAG.lastIndex < 0) break;
      const m = TAG.exec(text);
      if (!m || m.index !== 0) break;
      const ms = tagToMs(m[1], m[2], m[3]);
      if (ms === null) break;
      times.push(ms);
      text = text.slice(m[0].length);
    }
    if (times.length === 0) continue;

    const clean = text.trim();
    for (const timeMs of times) {
      result.push({ id: result.length, timeMs, text: clean });
    }
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

export function getActiveLineIndex(lyrics: LyricLine[], currentPlaybackMs: number): number {
  let activeIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    if (currentPlaybackMs >= lyrics[i].timeMs) {
      activeIndex = i;
    } else {
      break;
    }
  }
  return activeIndex;
}
