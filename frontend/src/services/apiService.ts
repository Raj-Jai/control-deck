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
