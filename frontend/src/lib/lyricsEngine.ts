export interface LyricLine {
  id: number;
  timeMs: number;
  text: string;
}

export function parseLRC(lrcText: string): LyricLine[] {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result: LyricLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match [mm:ss.xx] or [mm:ss.xxx] at the start
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (!match) continue;

    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    const msStr = match[3];
    const ms = msStr.length === 2 ? parseInt(msStr, 10) * 10 : parseInt(msStr, 10);
    const text = match[4].trim();

    result.push({
      id: i,
      timeMs: (min * 60 + sec) * 1000 + ms,
      text,
    });
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
