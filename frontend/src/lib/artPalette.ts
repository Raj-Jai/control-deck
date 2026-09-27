export interface Palette {
  primary: string;
  accent: string;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

/**
 * Pick a palette from RGBA pixel data.
 *
 * Kept separate from the DOM so the arithmetic can be tested: this used to run
 * inside an image load handler, where anything thrown left the previous track's
 * colours on screen with no way to tell that they were stale.
 *
 * Returns null when there is nothing usable - a transparent image, or one that
 * is entirely near-black or near-white - so the caller can drop back to the
 * theme's own accent rather than inventing one.
 */
export function paletteFromPixels(
  data: ArrayLike<number>,
  fallback: Palette,
): Palette | null {
  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  // Every 4th pixel: a 64x64 image has 4096 of them and this runs per track.
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a !== undefined && a < 128) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 8 || l > 92) continue;
    if (s < 6) continue; // grey contributes nothing but noise
    const key = Math.round(h / 30) * 30;
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r; existing.g += g; existing.b += b; existing.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  if (buckets.size === 0) return null;

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const pc = {
    r: Math.round(top.r / top.count),
    g: Math.round(top.g / top.count),
    b: Math.round(top.b / top.count),
  };

  const [h, s, l] = rgbToHsl(pc.r, pc.g, pc.b);
  // The accent is the complement, with its lightness clamped into a band that
  // stays legible against the card surfaces in either theme and never lands on
  // the foreground colour.
  const ah = (h + 180) % 360;
  const primary = `hsl(${h.toFixed(0)}, ${Math.min(70, s).toFixed(0)}%, ${Math.max(55, Math.min(80, l)).toFixed(0)}%)`;
  const accentL = Math.max(52, Math.min(64, l));
  const accentS = Math.max(45, Math.min(80, s));
  const accent = `hsl(${ah.toFixed(0)}, ${accentS.toFixed(0)}%, ${accentL.toFixed(0)}%)`;
  return { primary, accent };
}
