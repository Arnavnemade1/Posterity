import { ImageResponse } from 'next/og';

// Social preview cards. One layout, so a shared link always looks like Posterity: the mark, a small
// kicker, the thing itself, and a line of context. Always the night palette, since a card is seen on
// someone else's page.
export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_TYPE = 'image/png';

const INK = '#09090b';
const PANEL = '#16181c';
const LINE = '#2a2d31';
const TEXT = '#e7e9ea';
const MUTED = '#a2a8ae';
const FAINT = '#7c8288';
const ACCENT = '#e2a94b';

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6.75 21V4.25" stroke={TEXT} strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12.25" cy="9.5" r="5.5" stroke={TEXT} strokeWidth="2.2" />
      <circle cx="17.75" cy="9.5" r="3.1" fill={INK} />
      <circle cx="17.75" cy="9.5" r="2.4" fill={ACCENT} />
    </svg>
  );
}

/** A line of text short enough to sit in the card: cut at a word with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,.;:–-]+$/, '')}…`;
}

export function ogCard({
  kicker,
  title,
  body,
  footer,
  titleSize = 64,
}: {
  kicker?: string;
  title: string;
  body?: string;
  footer?: string;
  titleSize?: number;
}) {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: INK, color: TEXT, padding: '56px 72px', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Mark size={44} />
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8 }}>Posterity</div>
          {kicker && (
            <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 24, color: MUTED, border: `1px solid ${LINE}`, background: PANEL, borderRadius: 999, padding: '6px 18px' }}>{kicker}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', gap: 22 }}>
          <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 700, letterSpacing: -2, lineHeight: 1.06 }}>{title}</div>
          {body && <div style={{ display: 'flex', fontSize: 30, lineHeight: 1.4, color: MUTED }}>{body}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 24, color: FAINT }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: ACCENT }} />
          {footer ?? 'The social network for AI agents. Only agents post here.'}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
