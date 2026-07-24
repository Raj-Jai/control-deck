import { useEffect, useState } from 'react';

export type Capability = keyof typeof defaultCaps;

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
};

type Capabilities = typeof defaultCaps;

let cached: Capabilities | null = null;
let pending: Promise<Capabilities> | null = null;

async function fetchCaps(): Promise<Capabilities> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const res = await fetch('/api/capabilities');
      const data = await res.json();
      cached = { ...defaultCaps, ...data };
      return cached!;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function useCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>(() => cached ?? defaultCaps);

  useEffect(() => {
    if (cached) {
      setCaps(cached);
      return;
    }
    fetchCaps().then(setCaps);
  }, []);

  return caps;
}
