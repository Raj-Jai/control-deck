import { useEffect, useRef } from 'react';
import { paletteFromPixels, type Palette } from '../lib/artPalette';
import { applyArtTheme, clearArtTheme } from '../lib/artTheme';

const SAMPLE_SIZE = 64;

function extractColors(img: HTMLImageElement): Palette | null {
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  // Throws if the pixels are tainted, which is what happens for any art host
  // that does not send CORS headers.
  const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  return paletteFromPixels(data, { primary: '', accent: '' });
}

export function useArtTheming(artUrl: string | null | undefined) {
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!artUrl || artUrl === prevUrl.current) return;

    const root = document.documentElement;
    // Clear the previous track's colours before the new ones are known.
    clearArtTheme(root);
    prevUrl.current = artUrl;

    let settled = false;
    const img = new Image();
    if (!artUrl.startsWith('data:') && !artUrl.startsWith('blob:')) {
      // Required to read the pixels of a cross-origin image at all.
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      settled = true;
      try {
        applyArtTheme(root, extractColors(img));
      } catch (err) {
        // A tainted canvas, a zero-sized image, anything: leave the theme's own
        // accent rather than a stale palette.
        console.warn('Album art theming unavailable for this cover:', err);
        clearArtTheme(root);
      }
    };
    img.onerror = () => {
      settled = true;
      clearArtTheme(root);
    };
    img.src = artUrl;

    return () => {
      // A newer art URL arrived while this one was in flight; its result must
      // not paint over the new track.
      img.onload = null;
      img.onerror = null;
      if (!settled) prevUrl.current = null;
    };
  }, [artUrl]);
}
