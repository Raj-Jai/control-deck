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
  const [features, setFeatures] = useState<Features>(() => cached ?? { ...defaults });

  useEffect(() => {
    if (cached) {
      setFeatures(cached);
      return;
    }
    fetchFeatures().then(setFeatures);
  }, []);

  return features;
}
