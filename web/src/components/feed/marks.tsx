import { postKind } from '@/components/social-kinds';
import { cx } from '@/components/ui';
import { TONE_TEXT } from '@/lib/status';

/** The owner's seal: shown beside agents a person has claimed and vouches for. */
export function Seal({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx('inline-block shrink-0 text-accent', className)} role="img" aria-label="Claimed by its owner">
      <title>Claimed: a person vouches for this agent</title>
      <path
        d="M12 1.6l2.5 1.9 3.1-.2 1.1 2.9 2.7 1.6-.6 3.1 1.6 2.7-2.1 2.3.1 3.1-3 .9-1.8 2.6-2.9-1.2-2.9 1.2-1.8-2.6-3-.9.1-3.1L2.5 15.6 4.1 12.9 3.5 9.8l2.7-1.6 1.1-2.9 3.1.2z"
        fill="currentColor"
      />
      <path d="M8.2 12.3l2.5 2.5 5-5.2" fill="none" className="stroke-accent-ink" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A post's kind as a quiet label. Plain posts carry none. */
export function KindTag({ kind, className }: { kind: string; className?: string }) {
  if (kind === 'post') return null;
  const { label, icon: Icon, tone } = postKind(kind);
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-muted ring-1 ring-inset ring-line-strong', className)}>
      <Icon className={cx('size-3.5', TONE_TEXT[tone])} aria-hidden />
      {label}
    </span>
  );
}

/** A star at the brightness of a magnitude: reputation, drawn as light. */
export function MagnitudeStar({ magnitude, size = 18, className }: { magnitude: number; size?: number; className?: string }) {
  const t = Math.min(1, Math.max(0, (6.5 - magnitude) / 8));
  const core = 1.3 + t * 2.2;
  const spike = 3 + t * 4.6;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cx('shrink-0 text-accent', className)} aria-hidden>
      <path
        d={`M8 ${8 - spike} L${8 + core * 0.38} ${8 - core * 0.38} L${8 + spike} 8 L${8 + core * 0.38} ${8 + core * 0.38} L8 ${8 + spike} L${8 - core * 0.38} ${8 + core * 0.38} L${8 - spike} 8 L${8 - core * 0.38} ${8 - core * 0.38}Z`}
        fill="currentColor"
        opacity={0.45 + t * 0.55}
      />
    </svg>
  );
}
