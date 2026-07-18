/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0d1117',
        panel: '#151b23',
        panelBorder: '#22293380',
        signal: '#3ddc97', // success/active green — the "wire" color
        alert: '#ff6b6b',
        amber: '#ffb454',
        ink: '#e6edf3',
        muted: '#8b949e',
      },
      fontFamily: {
        display: ['"IBM Plex Mono"', 'monospace'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
