/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        wide: '800px',
      },
      colors: {
        deck: {
          bg: '#0f172a',
          surface: '#1e293b',
          surface2: '#334155',
          accent: '#06b6d4',
          'accent-dim': '#0891b2',
          text: '#f1f5f9',
          dim: '#94a3b8',
          muted: '#64748b',
        },
      },
      animation: {
        ripple: 'ripple 0.5s ease-out',
      },
      keyframes: {
        ripple: {
          to: { transform: 'scale(4)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
