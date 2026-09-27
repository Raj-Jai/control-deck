import { DECK_CONFIG } from '../config/deckConfig';

const { api } = DECK_CONFIG;

/**
 * Fire a registered command. Returns whether the host accepted it: the
 * response status was previously ignored, so a rejected or unknown command was
 * indistinguishable from a successful one. Callers that do not care can keep
 * ignoring the result.
 */
/** The result of a deck command that reports one. */
export interface CommandResult {
  ok: boolean;
  output: string;
}

/**
 * Run a command and return what it actually did.
 *
 * Only the IDE commands report a result - they are the ones the user cannot
 * otherwise observe, since they run git and task runners rather than driving a
 * media player. Other commands have no `ok` field, so the dispatch
 * acknowledgement is reported as the result.
 */
export async function runCommand(cmd: string, player?: string): Promise<CommandResult> {
  try {
    const res = await fetch(api.command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, ...(player ? { player } : {}) }),
    });
    if (!res.ok) {
      return { ok: false, output: `The host refused the command (HTTP ${res.status}).` };
    }
    const body = await res.json().catch(() => null) as { ok?: boolean; output?: string } | null;
    if (body && typeof body.ok === 'boolean') {
      return { ok: body.ok, output: body.output ?? '' };
    }
    return { ok: true, output: 'Dispatched.' };
  } catch (err) {
    return { ok: false, output: `Could not reach the host: ${String(err)}` };
  }
}

export async function triggerCommand(cmd: string, player?: string): Promise<boolean> {
  try {
    const res = await fetch(api.command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, ...(player ? { player } : {}) }),
    });
    if (!res.ok) {
      console.error(`Command ${cmd} rejected: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Command failed:', err);
    return false;
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

/**
 * Slider <-> value mapping for volume and brightness.
 *
 * These controls are labelled with a percentage, so the mapping must be
 * linear: the quadratic curve this used applied meant dragging to 50% set the
 * value to 25%, and the number on screen was not the number in effect.
 * PulseAudio's per-stream volume is linear as well, so the curve bought
 * nothing except the discrepancy.
 */
export function sliderToValue(sliderPos: number, rangeMax: number): number {
  return clampToRange(sliderPos, rangeMax);
}

export function valueToSlider(apiVal: number, rangeMax: number): number {
  return clampToRange(apiVal, rangeMax);
}

function clampToRange(v: number, rangeMax: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  return v > rangeMax ? rangeMax : v;
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
  active_subtitle: number;
  active_audio: number;
}

export async function fetchVideoStatus(): Promise<VideoStatus> {
  const res = await fetch('/api/video/status');
  return res.json();
}

/**
 * Returns whether the host actually applied the command. The status was
 * ignored, and the handler used to answer 200 "ok" even on failure, so a
 * rejected command was indistinguishable from one that worked.
 */
export async function sendVideoCommand(action: string, payload?: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch('/api/video/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) {
      console.error(`video command ${action} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`video command ${action} failed:`, err);
    return false;
  }
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


