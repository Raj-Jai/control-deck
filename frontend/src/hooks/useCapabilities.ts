import { useCallback, useEffect, useState } from 'react';

export type Capability = keyof typeof defaultCaps;

// Nothing is known yet, so everything reads as unavailable until the probe
// lands. Callers must not treat this as authoritative - see `capabilitiesReady`.
const defaultCaps = {
  caffeine: false,
  bluetooth: false,
  warp: false,
  erp: false,
  night_light: false,
  brightness: false,
  clipboard: false,
  ffmpeg: false,
  playerctl: false,
  battery: false,
  mpv: false,
  yt_dlp: false,
  kdeconnect: false,
};

export type Capabilities = typeof defaultCaps;

let cached: Capabilities | null = null;
let pending: Promise<Capabilities> | null = null;

const CAPS_TIMEOUT_MS = 5000;

/**
 * Probe the host's binaries.
 *
 * A rejected request used to propagate straight out of this promise, so a single
 * failed fetch left `caps` at defaultCaps - where everything is false - and
 * every capability-gated card silently disappeared with no error and no way to
 * ask again. Failing open matches useFeatures: an unreachable host must not
 * blank the UI, and the alternative (a dashboard with nothing on it) is worse
 * than one showing a button that turns out not to work.
 */
async function fetchCaps(): Promise<Capabilities> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), CAPS_TIMEOUT_MS);
      try {
        const res = await fetch('/api/capabilities', { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        cached = { ...defaultCaps, ...data };
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Fail open: assume the tools are there and let the command fail loudly
      // if they are not.
      cached = { ...defaultCaps };
      for (const k of Object.keys(defaultCaps) as Capability[]) {
        cached[k] = true;
      }
    } finally {
      pending = null;
    }
    return cached!;
  })();
  return pending;
}

export function useCapabilities(enabled = true) {
  const [caps, setCaps] = useState<Capabilities>(() => cached ?? defaultCaps);
  const [ready, setReady] = useState(() => cached !== null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    cached = null;
    setCaps(defaultCaps);
    setReady(false);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (cached) {
      setCaps(cached);
      setReady(true);
      return;
    }
    if (!enabled) return;
    let alive = true;
    fetchCaps().then((c) => {
      if (!alive) return;
      setCaps(c);
      setReady(true);
    });
    return () => { alive = false; };
  }, [enabled, attempt]);

  return { caps, capabilitiesReady: ready, retryCapabilities: retry };
}
