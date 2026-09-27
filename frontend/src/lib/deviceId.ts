/**
 * A device id that works everywhere the dashboard is actually used.
 *
 * `crypto.randomUUID()` only exists in a secure context, so over plain-HTTP LAN
 * - which is exactly how the README says to reach the dashboard from a phone -
 * it is undefined. The audit verified `hasRandomUUID: false` and
 * `isSecureContext: false` on http://<lan-ip>:18081, and `device_id=` empty on
 * every request as a result. That silently disabled per-device stream control,
 * per-device audio WebSocket registration and the whole hotkey broadcast path,
 * because every request carried an empty id and the server answered
 * "404 device not connected".
 *
 * `crypto.getRandomValues` is available in every context, including insecure
 * ones, so a v4 UUID is built from it when randomUUID is missing.
 */

const DEVICE_KEY = 'dash_device_id';

function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* fall through to the manual path */
    }
  }
  if (!c || typeof c.getRandomValues !== 'function') {
    // Last resort. Not cryptographically strong, but it only has to be unique
    // enough to tell two tabs on one machine apart.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c2) => {
      const r = (Math.random() * 16) | 0;
      const v = c2 === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  const hex = [...b].map((v) => v.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

/**
 * The device id, stable for the lifetime of the install.
 *
 * localStorage rather than sessionStorage: a tab refresh used to orphan the
 * audio WebSocket registration, because the server had registered the old id
 * and the new page announced a different one (CF-07).
 */
export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return randomUUID();
  }
}
