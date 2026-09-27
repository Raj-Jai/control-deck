/** @type {import('tailwindcss').Config} */

/**
 * Colours are CSS custom properties holding space-separated RGB channels, so
 * Tailwind's opacity modifiers keep working (`bg-deck-accent/15`) and a theme
 * switch is a matter of changing variables in one place - index.css - rather
 * than editing hundreds of call sites.
 *
 * The dark theme is the default because that is the established look of the
 * dashboard; the light theme is a real second theme, not an inversion.
 */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        wide: '800px',
      },
      colors: {
        deck: {
          // Surfaces, darkest to lightest.
          bg: token('--cd-bg'),
          sunken: token('--cd-sunken'),
          surface: token('--cd-surface'),
          'surface-2': token('--cd-surface-2'),
          'surface-3': token('--cd-surface-3'),
          // A control sitting on a card, so it reads as a layer of its own.
          tile: token('--cd-tile'),
          'tile-hover': token('--cd-tile-hover'),
          // Slider and meter tracks, which must read against the card they
          // sit on. Distinct from surface-2, which in the light theme is the
          // same value as the page background.
          track: token('--cd-track'),
          // Lines.
          hairline: token('--cd-hairline'),
          'hairline-strong': token('--cd-hairline-strong'),
          // Text.
          text: token('--cd-text'),
          dim: token('--cd-dim'),
          muted: token('--cd-muted'),
          // Brand.
          accent: token('--cd-accent'),
          'accent-dim': token('--cd-accent-dim'),
          'accent-contrast': token('--cd-accent-contrast'),
          // Status. Used for play/pause state, confirmations and failures, so
          // they are tokens too rather than literal green-400 / red-400.
          success: token('--cd-success'),
          warning: token('--cd-warning'),
          danger: token('--cd-danger'),
        },
      },
      borderRadius: {
        card: 'var(--cd-radius-card)',
        control: 'var(--cd-radius-control)',
      },
      boxShadow: {
        card: 'var(--cd-shadow-card)',
        raised: 'var(--cd-shadow-raised)',
        focus: 'var(--cd-shadow-focus)',
      },
      spacing: {
        // A named spacing scale, so gaps between related elements are
        // consistent rather than picked per component.
        hairline: '1px',
        touch: '44px',
      },
      fontSize: {
        // The deck is read at arm's length on a tablet, so the type scale skips
        // the 9-10px sizes the old ad-hoc classes had drifted into.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.4rem' }],
        md: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.65rem' }],
      },
      transitionDuration: {
        120: '120ms',
      },
    },
  },
  plugins: [],
};
