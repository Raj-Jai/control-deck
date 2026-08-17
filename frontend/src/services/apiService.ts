import { DECK_CONFIG } from '../config/deckConfig';

const { api } = DECK_CONFIG;

export async function triggerCommand(cmd: string, player?: string): Promise<void> {
  try {
    await fetch(api.command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, ...(player ? { player } : {}) }),
    });
  } catch (err) {
    console.error('Command failed:', err);
  }
}

export async function seekTo(position: number, player?: string): Promise<void> {
  try {
    await fetch(api.seek, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position, ...(player ? { player } : {}) }),
    });
  } catch (err) {
    console.error('Seek failed:', err);
  }
}

export async function setVolume(volume: number): Promise<void> {
  try {
    await fetch(api.volume, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    });
  } catch (err) {
    console.error('Set volume failed:', err);
  }
}

export async function setBrightness(brightness: number): Promise<void> {
  try {
    await fetch(api.brightness, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brightness }),
    });
  } catch (err) {
    console.error('Set brightness failed:', err);
  }
}

export async function pullHostClipboard(): Promise<string> {
  const res = await fetch('/api/clipboard/pull');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text;
}

export async function pushHostClipboard(text: string): Promise<void> {
  const res = await fetch('/api/clipboard/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

/** Logarithmic scale helpers for human-perceptual volume/brightness sliders */
export function sliderToValue(sliderPos: number, rangeMax: number): number {
  const norm = sliderPos / rangeMax;
  return norm * norm * rangeMax;
}
export function valueToSlider(apiVal: number, rangeMax: number): number {
  const norm = apiVal / rangeMax;
  return Math.sqrt(norm) * rangeMax;
}

export interface SinkInfo {
  id: number;
  name: string;
  description: string;
  default: boolean;
}

export async function fetchSinks(): Promise<SinkInfo[]> {
  const res = await fetch('/api/audio/sinks');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function setDefaultSink(id: number): Promise<void> {
  const res = await fetch('/api/audio/set-sink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
}

export async function getAudioStreamStatus(): Promise<boolean> {
  const res = await fetch('/api/audio-stream/status');
  const data = await res.json();
  return data.active;
}

export interface VideoTrack {
  id: number;
  title: string;
  active: boolean;
}

export interface VideoStatus {
  active_player: string;
  sub_delay: number;
  audio_delay: number;
  aspect_ratio: string;
  speed: number;
  position: number;
  length: number;
  subtitles: VideoTrack[];
  audio_tracks: VideoTrack[];
}

export async function fetchVideoStatus(): Promise<VideoStatus> {
  const res = await fetch('/api/video/status');
  return res.json();
}

export async function sendVideoCommand(action: string, payload?: Record<string, unknown>): Promise<void> {
  await fetch('/api/video/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
}

export interface MusicSearchResult {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  url: string;
}

export interface MusicSearchResponse {
  query: string;
  results: MusicSearchResult[];
}

export async function searchMusic(query: string, n = 8): Promise<MusicSearchResult[]> {
  const res = await fetch(`/api/music/search?q=${encodeURIComponent(query)}&n=${n}`);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Search failed (${res.status}): ${t}`);
  }
  const data = (await res.json()) as MusicSearchResponse;
  return data.results ?? [];
}

export async function playMusic(url: string, title?: string, artist?: string): Promise<void> {
  const params = new URLSearchParams({ url });
  if (title) params.set('title', title);
  if (artist) params.set('artist', artist);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`/api/music/play?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Play failed (${res.status}): ${text}`);
    }
  } finally {
    clearTimeout(t);
  }
}

export interface OpenMediaResult {
  opened: boolean;
  paused: boolean;
  url: string;
  player: string;
  seconds: number;
}

export async function openInBrowser(player?: string): Promise<OpenMediaResult> {
  const res = await fetch('/api/music/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(player ? { player } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Open failed (${res.status}): ${text}`);
  }
  const result = (await res.json()) as OpenMediaResult;
  // Open the resolved URL in a new tab on THIS device (the client), not the
  // server. The server has already paused the laptop player.
  if (result.url) {
    window.open(result.url, '_blank', 'noopener');
  }
  return result;
}

export interface HandoffDevice {
  id: string;
  name: string;
}

export interface HandoffResult {
  opened: boolean;
  paused: boolean;
  url: string;
  player: string;
  device: string;
  seconds: number;
}

export async function listHandoffDevices(): Promise<HandoffDevice[]> {
  const res = await fetch('/api/music/handoff-devices');
  const data = await res.json();
  return (data.devices ?? []) as HandoffDevice[];
}

export async function handoffToPhone(player?: string, device?: string): Promise<HandoffResult> {
  const res = await fetch('/api/music/handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(player ? { player } : {}), ...(device ? { device } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Handoff failed (${res.status}): ${text}`);
  }
  return (await res.json()) as HandoffResult;
}


