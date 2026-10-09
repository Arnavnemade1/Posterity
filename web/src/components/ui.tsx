import Link from 'next/link';
import { type Glyph, lookup, TONE_DOT, TONE_HEX, TONE_TEXT, type Tone } from '@/lib/status';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1200px] px-5 sm:px-8', className)}>{children}</div>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ember';
type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-[9px] px-3 text-[13px]',
  md: 'h-9.5 rounded-[10px] px-4 text-sm',
  lg: 'h-11 rounded-xl px-5 text-[15px]',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cx('btn', `btn-${variant}`, SIZE[size]);
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
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link href={href} className={cx(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

/** Status glyphs: an empty ring fills as work moves toward verification. */
export function StatusIcon({ glyph, tone, size = 14, className }: { glyph: Glyph; tone: Tone; size?: number; className?: string }) {
  const color = TONE_HEX[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={cx('shrink-0', className)}>
      {glyph === 'check' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M5 8.2l2 2 4-4.3" stroke="#08090b" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : glyph === 'cross' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} fillOpacity={tone === 'danger' ? 1 : 0.55} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#08090b" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.1"
            stroke={color}
            strokeWidth="1.6"
            strokeDasharray={glyph === 'dashed' ? '2.4 2.2' : glyph === 'dotted' ? '0.1 2.6' : undefined}
            strokeLinecap="round"
          />
          {glyph === 'half' && <path d="M8 8V4.4a3.6 3.6 0 0 1 0 7.2Z" fill={color} />}
          {glyph === 'most' && <path d="M8 8V4.4a3.6 3.6 0 1 1-3.6 3.6Z" fill={color} />}
          {glyph === 'pause' && <path d="M6.6 5.8v4.4M9.4 5.8v4.4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

export function Pill({ tone, children, dot = true, className }: { tone: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full bg-white/[0.04] px-2 text-[12px] font-medium text-muted ring-1 ring-inset ring-white/[0.07]',
        className,
      )}
    >
      {dot && <span className={cx('size-1.5 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export function StatusPill({
  map,
  status,
  className,
}: {
  map: Record<string, [string, Tone, Glyph?]>;
  status: string;
  className?: string;
}) {
  const [label, tone, glyph] = lookup(map, status);
  return (
    <span
      className={cx(
        'inline-flex h-[22px] items-center gap-1.5 rounded-full bg-white/[0.04] pl-1.5 pr-2 text-[12px] font-medium text-text/85 ring-1 ring-inset ring-white/[0.07]',
        className,
      )}
    >
      <StatusIcon glyph={glyph} tone={tone} size={13} />
      {label}
    </span>
  );
}

export function StatusLabel({ map, status }: { map: Record<string, [string, Tone, Glyph?]>; status: string }) {
  const [label, tone, glyph] = lookup(map, status);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13px]', TONE_TEXT[tone])}>
      <StatusIcon glyph={glyph} tone={tone} />
      <span className="text-muted">{label}</span>
    </span>
  );
}

export function Chip({ children, href }: { children: React.ReactNode; href?: string }) {
  const className =
    'inline-flex h-[22px] items-center rounded-md bg-white/[0.035] px-1.5 font-mono text-[11px] text-muted ring-1 ring-inset ring-white/[0.06]';
  return href ? (
    <Link href={href} className={cx(className, 'transition-colors hover:bg-white/[0.06] hover:text-text')}>
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
      <div
        className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-done/60 to-done shadow-[0_0_12px_rgb(79_209_139/0.45)] transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-faint">
        {done}/{total}
      </span>
    </div>
  );
}

export function SectionHeading({
  label,
  title,
  action,
  className,
}: {
  label?: string;
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-5 flex items-end justify-between gap-4', className)}>
      <div>
        {label && <div className="label mb-1.5 text-faint">{label}</div>}
        <h2 className="heading text-[19px] leading-tight text-text">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-2xl px-6 py-12 text-center ring-1 ring-inset ring-white/[0.06]', className)}>
      <div className="dot-grid mask-fade-b pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="relative">
        <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08]">
          <span className="size-1.5 rounded-full bg-faint" />
        </div>
        <p className="heading text-[17px] text-text">{title}</p>
        {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="label text-faint">{label}</div>
      <div className="heading mt-2 text-[26px] leading-none tabular-nums text-text">{value}</div>
      {hint && <div className="mt-2 text-xs text-faint">{hint}</div>}
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

/** The top of every app page: an eyebrow, a lit headline and the page's primary actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('relative -mt-[60px] overflow-hidden pt-[60px]', className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-260px] h-[520px] w-[1000px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.05),transparent)]" />
        <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_60%_80%_at_50%_0%,#000,transparent)]" />
      </div>
      <Container className="relative pb-10 pt-12 sm:pb-12 sm:pt-16">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0 max-w-3xl animate-[rise_800ms_var(--ease-out-expo)_both]">
            {eyebrow && <div className="eyebrow mb-4">{eyebrow}</div>}
            <h1 className="heading text-gradient text-[clamp(34px,4.6vw,52px)] leading-[1.04] tracking-[-0.04em]">{title}</h1>
            {description && <div className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-muted">{description}</div>}
          </div>
          {actions && <div className="flex animate-[rise_800ms_var(--ease-out-expo)_80ms_both] flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-8 animate-[rise_800ms_var(--ease-out-expo)_120ms_both]">{children}</div>}
      </Container>
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow">
      <span className="h-px w-5 bg-gradient-to-r from-transparent to-accent" />
      {children}
    </span>
  );
}

/** Link-based segmented control for filters and sort orders. */
export function Segmented({ items, label }: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[11px] bg-white/[0.03] p-1 ring-1 ring-inset ring-white/[0.07]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-all',
            item.active
              ? 'bg-white/[0.09] text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_1px_2px_rgb(0_0_0/0.4)]'
              : 'text-faint hover:text-muted',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
