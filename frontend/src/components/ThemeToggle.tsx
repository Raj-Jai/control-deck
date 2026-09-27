import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { applyTheme, saveTheme, storedTheme, type Theme } from '../lib/theme';

/**
 * Switches between the light and dark themes.
 *
 * The first press is not the system setting, it is the opposite of whatever is
 * showing - so a user who has never thought about themes gets a visible result
 * from one tap and can then tell which is which from the icon.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => storedTheme());

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className={`icon-btn min-h-[44px] min-w-[44px] ${className}`}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      aria-pressed={theme === 'light'}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
