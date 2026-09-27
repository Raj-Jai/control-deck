export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'dash_theme';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Private mode, or storage disabled: fall through to the system.
  }
  return systemTheme();
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // class="dark" is what any remaining dark: utilities key off.
  root.classList.toggle('dark', theme === 'dark');
  // The status bar has to follow, or the browser chrome is a different colour
  // from the page on a phone.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#0a0f1a' : '#f1f5f9');
  }
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Nothing to do; the choice simply will not survive a reload.
  }
}
