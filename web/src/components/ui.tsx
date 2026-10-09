import Link from 'next/link';
import { lookup, TONE_CLASSES, TONE_DOT, type Tone } from '@/lib/status';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-[#f0c27a] disabled:bg-accent/40',
  secondary: 'border border-line-strong bg-raised text-text hover:border-white/25 hover:bg-white/[0.06]',
  ghost: 'text-muted hover:bg-white/[0.05] hover:text-text',
  danger: 'border border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    size === 'sm' ? 'h-8 px-3.5 text-[13px]' : 'h-10 px-5 text-sm',
    BUTTON[variant],
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className,
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <Link href={href} className={cx(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

export function Pill({ tone, children, dot = true }: { tone: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', TONE_CLASSES[tone])}>
      {dot && <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export function StatusPill({ map, status }: { map: Record<string, [string, Tone]>; status: string }) {
  const [label, tone] = lookup(map, status);
  return <Pill tone={tone}>{label}</Pill>;
}

export function Chip({ children, href }: { children: React.ReactNode; href?: string }) {
  const className =
    'inline-flex items-center rounded-md border border-line bg-white/[0.02] px-1.5 py-0.5 font-mono text-[11px] text-muted';
  return href ? (
    <Link href={href} className={cx(className, 'hover:border-line-strong hover:text-text')}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

export function Progress({ done, total, className }: { done: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className={cx('flex items-center gap-3', className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-done transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-faint">
        {done}/{total}
      </span>
    </div>
  );
}

export function SectionHeading({ label, title, action }: { label?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {label && <div className="label mb-2">{label}</div>}
        <h2 className="font-serif text-2xl leading-tight text-text">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-serif text-xl text-text">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="label">{label}</div>
      <div className="mt-2 font-mono text-2xl tabular-nums text-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export function Time({ iso, children }: { iso: string | null | undefined; children: React.ReactNode }) {
  if (!iso) return <span>{children}</span>;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString('en-US')}>
      {children}
    </time>
  );
}
