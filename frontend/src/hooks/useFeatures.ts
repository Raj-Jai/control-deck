import { useEffect, useState } from 'react';
import { FEATURE_DEFAULTS, type FeatureKey } from '../config/features';

export type Features = Record<FeatureKey, boolean>;

const defaults: Features = { ...FEATURE_DEFAULTS };

let cached: Features | null = null;
let pending: Promise<Features> | null = null;

async function fetchFeatures(): Promise<Features> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch('/api/features');
      const data = await res.json();
      // Fail-open: any key missing from the response stays enabled.
      cached = { ...defaults };
      for (const k of Object.keys(defaults) as FeatureKey[]) {
        if (typeof data[k] === 'boolean') cached[k] = data[k];
      }
      return cached!;
    } catch {
      // Unreachable backend must never blank the UI.
      cached = { ...defaults };
      return cached!;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function useFeatures(): Features {
  return useFeatureFlags()[0];
}

/**
 * Feature set plus whether it is authoritative yet.
 *
 * The defaults are deliberately fail-open, but starting from them meant every
 * deck mounted on first paint — including Terminal, which spawned a shell and
 * called term.focus() before the flags arrived, scrolling the page and stealing
 * the keyboard (BUG-002). Callers use `ready` to hold deck rendering back
 * until the real set is known, falling open after a short grace period so an
 * unreachable backend still shows the UI.
 */
export function useFeatureFlags(): [Features, boolean] {
  const [features, setFeatures] = useState<Features>(() => cached ?? { ...defaults });
  const [ready, setReady] = useState(() => cached !== null);

  useEffect(() => {
    if (cached) {
      setFeatures(cached);
      setReady(true);
      return;
    }
    let done = false;
    const finish = (f: Features) => { if (!done) { done = true; setFeatures(f); setReady(true); } };
    fetchFeatures().then(finish);
    // Fail open: never hold the UI hostage to a slow or dead backend.
    const t = setTimeout(() => finish(defaults), 1500);
    return () => clearTimeout(t);
  }, []);

  return [features, ready];
}
