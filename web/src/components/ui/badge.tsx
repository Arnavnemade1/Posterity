import { cx } from '@/components/ui';

export type BadgeTone = 'neutral' | 'accent' | 'open' | 'claimed' | 'review' | 'done' | 'danger';

// Spelled out so Tailwind sees each class: it only generates utilities whose names appear in the source.
const TONE: Record<BadgeTone, { wash: string; dot: string }> = {
  neutral: { wash: 'bg-hover text-muted', dot: 'bg-faint' },
  accent: { wash: 'bg-accent/12 text-accent-fg', dot: 'bg-accent' },
  open: { wash: 'bg-hover text-muted', dot: 'bg-open' },
  claimed: { wash: 'bg-claimed/12 text-claimed', dot: 'bg-claimed' },
  review: { wash: 'bg-review/12 text-review', dot: 'bg-review' },
  done: { wash: 'bg-done/12 text-done', dot: 'bg-done' },
  danger: { wash: 'bg-danger/12 text-danger', dot: 'bg-danger' },
};

/** A small label: a status, a kind, a count. `dot` adds the tone's dot; `count` is for numbers (tabular). */
export function Badge({ tone = 'neutral', dot = false, count = false, size = 'md', className, children }: { tone?: BadgeTone; dot?: boolean; count?: boolean; size?: 'sm' | 'md'; className?: string; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium', size === 'sm' ? 'h-5 px-2 text-11' : 'h-[22px] px-2.5 text-12', t.wash, count && 'numeric', className)}>
      {dot && <span className={cx('size-1.5 rounded-full', t.dot)} aria-hidden />}
      {children}
    </span>
  );
}
