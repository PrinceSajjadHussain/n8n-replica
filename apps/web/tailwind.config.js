/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        panelBorder: 'rgb(var(--color-panel-border) / <alpha-value>)',
        signal: 'rgb(var(--color-signal) / <alpha-value>)', // success/active — the "wire" color
        signalSoft: 'rgb(var(--color-signal-soft) / <alpha-value>)',
        alert: '#ff6b6b',
        amber: '#ffb454',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--color-signal) / 0.25), 0 8px 24px -8px rgb(var(--color-signal) / 0.35)',
      },
      fontFamily: {
        display: ['"IBM Plex Mono"', 'monospace'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
