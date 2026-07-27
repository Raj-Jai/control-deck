import { useEffect, useRef } from 'react';

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
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

function extractColors(img: HTMLImageElement): { primary: string; accent: string } {
  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  const buckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  const step = 4;
  for (let i = 0; i < data.length; i += step * 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 8 || l > 92) continue; // skip near-black/white
    const key = Math.round(h / 30) * 30;
    const existing = buckets.get(key);
    if (existing) {
      existing.r += r;
      existing.g += g;
      existing.b += b;
      existing.count++;
    } else {
      buckets.set(key, { r, g, b, count: 1 });
    }
  }

  if (buckets.size === 0) {
    return { primary: '#06b6d4', accent: '#06b6d4' };
  }

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const pc = {
    r: Math.round(top.r / top.count),
    g: Math.round(top.g / top.count),
    b: Math.round(top.b / top.count),
  };

  // accent: shift hue by 180 for complementary
  const [h, s, l] = rgbToHsl(pc.r, pc.g, pc.b);
  const ah = (h + 180) % 360;
  const primary = `hsl(${h.toFixed(0)}, ${Math.min(70, s).toFixed(0)}%, ${Math.max(55, Math.min(80, l)).toFixed(0)}%)`;
  const accent = `hsl(${ah.toFixed(0)}, 80%, 55%)`;
  return { primary, accent };
}

export function useArtTheming(artUrl: string | null | undefined) {
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!artUrl || artUrl === prevUrl.current) return;
    prevUrl.current = artUrl;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const { primary, accent } = extractColors(img);
      document.documentElement.style.setProperty('--art-primary', primary);
      document.documentElement.style.setProperty('--art-accent', accent);
      document.documentElement.classList.add('art-themed');
    };
    img.onerror = () => {
      document.documentElement.classList.remove('art-themed');
    };
    img.src = artUrl;
  }, [artUrl]);
}
