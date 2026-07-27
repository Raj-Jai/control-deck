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

