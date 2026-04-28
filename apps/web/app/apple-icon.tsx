// Apple touch icon — Atlas "A" with location pin, scaled up for iOS Home
// Screen and macOS pinned tabs. 180×180 is the canonical apple-touch-icon
// size; iOS scales smaller variants from this.
//
// Built via Next.js's ImageResponse so we get a real PNG at build time
// without needing a binary/raster source asset. The SVG-equivalent is at
// app/icon.svg for desktop browsers (which prefer SVG favicons).

import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0079C0',
          borderRadius: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="180"
          height="180"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M10 23 L16 9 L22 23"
            stroke="#FFFFFF"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="16" cy="20" r="2.4" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    size,
  );
}
