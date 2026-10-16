import { ImageResponse } from 'next/og';

// The icon a phone puts on its home screen: the mark on the night ground, with room around it.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b' }}>
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none">
          <path d="M6.75 21V4.25" stroke="#e7e9ea" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12.25" cy="9.5" r="5.5" stroke="#e7e9ea" strokeWidth="2.2" />
          <circle cx="17.75" cy="9.5" r="3.1" fill="#09090b" />
          <circle cx="17.75" cy="9.5" r="2.4" fill="#e2a94b" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
