import Link from 'next/link';
import { type Glyph, lookup, TONE_DOT, TONE_TEXT, type Tone } from '@/lib/status';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1200px] px-5 sm:px-8', className)}>{children}</div>;
}

/** Content inside an app column: the column's own gutter, no max width of its own. */
export function Section({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('px-4 sm:px-5', className)}>
      {children}
    </section>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ember';
type ButtonSize = 'sm' | 'md' | 'lg';

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9.5 px-4 text-[14px]',
  lg: 'h-11 px-5 text-[15px]',
};

// Spelled out so Tailwind sees each class: it only generates utilities whose names appear in the source.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  ember: 'btn-ember',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cx('btn', VARIANT[variant], SIZE[size]);
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

/** Status glyphs: an empty ring fills as work moves toward verification. Drawn in the tone's colour. */
export function StatusIcon({ glyph, tone, size = 14, className }: { glyph: Glyph; tone: Tone; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden className={cx('shrink-0', TONE_TEXT[tone], className)}>
      {glyph === 'check' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M5 8.2l2 2 4-4.3" className="stroke-ink" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : glyph === 'cross' ? (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity={tone === 'danger' ? 1 : 0.55} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" className="stroke-ink" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6.1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeDasharray={glyph === 'dashed' ? '2.4 2.2' : glyph === 'dotted' ? '0.1 2.6' : undefined}
            strokeLinecap="round"
          />
          {glyph === 'half' && <path d="M8 8V4.4a3.6 3.6 0 0 1 0 7.2Z" fill="currentColor" />}
          {glyph === 'most' && <path d="M8 8V4.4a3.6 3.6 0 1 1-3.6 3.6Z" fill="currentColor" />}
          {glyph === 'pause' && <path d="M6.6 5.8v4.4M9.4 5.8v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
        </>
      )}
    </svg>
  );
}

export function Pill({ tone, children, dot = true, className }: { tone: Tone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 px-2 text-[12px] font-medium text-muted ring-1 ring-inset ring-line', className)}>
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
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 pl-1.5 pr-2 text-[12px] font-medium text-text ring-1 ring-inset ring-line', className)}>
      <StatusIcon glyph={glyph} tone={tone} size={13} />
      {label}
    </span>
  );
}

export function StatusLabel({ map, status }: { map: Record<string, [string, Tone, Glyph?]>; status: string }) {
  const [label, tone, glyph] = lookup(map, status);
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <StatusIcon glyph={glyph} tone={tone} />
      <span className="text-muted">{label}</span>
    </span>
  );
}

export function Chip({ children, href }: { children: React.ReactNode; href?: string }) {
  const className = 'inline-flex h-[24px] items-center rounded-md px-2 text-[12.5px] text-muted ring-1 ring-inset ring-line-strong';
  return href ? (
    <Link href={href} className={cx(className, 'transition-colors hover:bg-fg/[0.05] hover:text-text')}>
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
      <div className="relative h-[3px] flex-1 overflow-hidden bg-fg/[0.08]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-done transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <span className="numeric text-[11px] text-faint">
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
    <div className={cx('mb-4 flex items-end justify-between gap-4', className)}>
      <div>
        {label && <div className="mb-1.5 text-[12.5px] text-faint">{label}</div>}
        <h2 className="display text-[22px] leading-tight text-text">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/** Nothing here yet: a small chart of an empty patch of sky, and a line of copy. */
export function EmptyState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('relative px-6 py-12 text-center ring-1 ring-inset ring-line', className)}>
      <svg width="72" height="46" viewBox="0 0 88 56" className="mx-auto text-line-strong" aria-hidden>
        <path d="M4 28h80M44 4v48" stroke="currentColor" strokeDasharray="2 3" />
        <circle cx="44" cy="28" r="18" fill="none" stroke="currentColor" />
        <circle cx="44" cy="28" r="1.6" className="fill-accent" />
      </svg>
      <p className="display mt-4 text-[20px] text-text">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[12.5px] text-faint">{label}</div>
      <div className="numeric mt-2 text-[24px] leading-none text-text">{value}</div>
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

/** The top of a page: a kicker, a serif headline, a standfirst, and the page's actions. */
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
    <div className={cx('border-b border-line', className)}>
      <div className="px-4 pb-6 pt-6 sm:px-5 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0 max-w-3xl animate-[rise_600ms_var(--ease-out-expo)_both]">
            {eyebrow && <div className="mb-3">{eyebrow}</div>}
            <h1 className="display text-[clamp(30px,4vw,42px)] leading-[1.06] text-text">{title}</h1>
            {description && <div className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{description}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="eyebrow">
      <span className="h-px w-5 bg-accent" />
      {children}
    </span>
  );
}

/** Link-based segmented control for filters and sort orders. */
export function Segmented({ items, label }: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto ring-1 ring-inset ring-line [scrollbar-width:none]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap px-3 py-1.5 text-[13px] font-medium transition-colors',
            item.active ? 'bg-fg/[0.08] text-text' : 'text-faint hover:text-text',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
