import type { Config } from 'tailwindcss';

// Per Scholas brand palette — values from the May 2025 brand book.
// Use these tokens directly (e.g. `bg-royal`, `text-night`) rather than
// reaching for `text-blue-600`. Brand rule: "Use color with restraint.
// Keep typography black and gray on white, with orange or royal for emphasis."
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Blues (primary brand spectrum)
        night:  '#071E39', // deepest navy — section headers, footers
        navy:   '#09507C', // primary brand blue — body emphasis
        royal:  '#0079C0', // primary callout color — links, primary CTAs
        ocean:  '#009CDB', // secondary blue — supporting accent
        sky:    '#7DC5D7', // pale blue — hover states, subtle backgrounds

        // Warm accents (use sparingly)
        orange: '#FF8000', // CTA / action / alert — Manual Fetch button only
        yellow: '#FEC14F', // medium-confidence states, highlights

        // Neutrals
        cloud:  '#EAE7DF', // warm off-white — section dividers, soft fills
      },
      fontFamily: {
        // Roboto is the brand book's documented free alternative to
        // Nitti Grotesk (which is paid Adobe Fonts only). Loaded via
        // next/font/google in app/layout.tsx as a CSS variable.
        sans: ['var(--font-roboto)', 'system-ui', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
