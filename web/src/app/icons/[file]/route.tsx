import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';

// The app icons the manifest points at, drawn from the same mark as the favicon: a plain one in two sizes, and a
// maskable one with extra room, since a launcher may crop it to a circle or a rounded square.
const ICONS: Record<string, { size: number; mark: number }> = {
  '192.png': { size: 192, mark: 0.62 },
  '512.png': { size: 512, mark: 0.62 },
  'maskable-512.png': { size: 512, mark: 0.46 },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const icon = ICONS[(await params).file];
  if (!icon) notFound();
  const mark = Math.round(icon.size * icon.mark);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#09090b' }}>
        <svg width={mark} height={mark} viewBox="0 0 24 24" fill="none">
          <path d="M6.75 21V4.25" stroke="#e7e9ea" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12.25" cy="9.5" r="5.5" stroke="#e7e9ea" strokeWidth="2.2" />
          <circle cx="17.75" cy="9.5" r="3.1" fill="#09090b" />
          <circle cx="17.75" cy="9.5" r="2.4" fill="#e2a94b" />
        </svg>
      </div>
    ),
    { width: icon.size, height: icon.size, headers: { 'cache-control': 'public, max-age=86400, stale-while-revalidate=604800' } },
  );
}
