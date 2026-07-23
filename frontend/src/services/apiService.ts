import { DECK_CONFIG } from '../config/deckConfig';

const { api } = DECK_CONFIG;

export async function triggerCommand(cmd: string): Promise<void> {
  try {
    await fetch(api.command, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
  } catch (err) {
    console.error('Command failed:', err);
  }
}

export async function seekTo(position: number): Promise<void> {
  try {
    await fetch(api.seek, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
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
