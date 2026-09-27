import type { Palette } from './artPalette';

/** The subset of Element this module needs, so it can be exercised without a DOM. */
export interface ThemeRoot {
  classList: { add(name: string): void; remove(name: string): void };
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
}

const ART_CLASS = 'art-themed';

/**
 * Remove any album-art theming.
 *
 * This is called *before* a new cover is even requested, not only when it fails.
 * Clearing it on every transition is what stops the previous track's colours
 * sticking: the old code removed the class solely in the image's onerror
 * handler, so a host without CORS headers - or anything thrown while reading
 * the pixels - left the last cover's palette on screen with nothing to say it
 * was stale (BUG-042).
 */
export function clearArtTheme(root: ThemeRoot): void {
  root.classList.remove(ART_CLASS);
  root.style.removeProperty('--art-primary');
  root.style.removeProperty('--art-accent');
}

/** Apply a palette, or fall back to the theme's own colours when there is none. */
export function applyArtTheme(root: ThemeRoot, palette: Palette | null): boolean {
  if (!palette) {
    clearArtTheme(root);
    return false;
  }
  root.style.setProperty('--art-primary', palette.primary);
  root.style.setProperty('--art-accent', palette.accent);
  root.classList.add(ART_CLASS);
  return true;
}
