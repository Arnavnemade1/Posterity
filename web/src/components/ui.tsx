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
  sm: 'h-8 px-3 text-13',
  md: 'h-9.5 px-4 text-14',
  lg: 'h-11 px-5 text-15',
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
    <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-full bg-hover px-2.5 text-12 font-medium text-muted', className)}>
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
    <span className={cx('inline-flex h-[24px] items-center gap-1.5 rounded-full bg-hover pl-1.5 pr-2.5 text-12 font-medium text-text', className)}>
      <StatusIcon glyph={glyph} tone={tone} size={13} />
      {label}
    </span>
  );
}

export function Chip({ children, href }: { children: React.ReactNode; href?: string }) {
  const className = 'inline-flex h-[26px] items-center rounded-full bg-hover px-2.5 text-13 text-muted';
  return href ? (
    <Link href={href} className={cx(className, 'transition-colors hover:bg-active hover:text-text')}>
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
      <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-active" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-done transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <span className="numeric text-12 text-faint">
        {done}/{total}
      </span>
    </div>
  );
}

/**
 * Nothing here yet. One look for every empty list: a quiet icon tile, a line that says what this place is for,
 * and the one thing to do about it. `compact` drops the padding for use inside a panel.
 */
export function EmptyState({
  title,
  children,
  icon,
  action,
  compact = false,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  /** A lucide icon element, size set by the tile. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('mx-auto flex max-w-md flex-col items-center text-center', compact ? 'px-4 py-8' : 'px-6 py-16', className)}>
      {icon && <span className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-raised text-muted [&_svg]:size-5">{icon}</span>}
      <p className="text-17 font-semibold tracking-[-0.015em] text-text">{title}</p>
      {children && <div className="mt-1.5 text-14 leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-13 text-faint">{label}</div>
      <div className="numeric mt-2 text-24 font-semibold leading-none tracking-[-0.02em] text-text">{value}</div>
      {hint && <div className="mt-2 text-12 text-faint">{hint}</div>}
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
    <nav aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-hover p-[3px] [scrollbar-width:none]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap rounded-full px-3.5 py-1.5 text-13 font-medium transition-colors',
            item.active ? 'bg-selected text-text' : 'text-faint hover:text-text',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** A row of link chips that narrows a list: the active one is solid. */
export function FilterChips({ items, label, className }: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cx('flex gap-1.5 overflow-x-auto px-4 py-3 [scrollbar-width:none]', className)}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cx(
            'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-13 font-medium transition-colors',
            item.active ? 'bg-text text-ink' : 'bg-hover text-muted hover:bg-active hover:text-text',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** A titled block on a detail page. */
export function Panel({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('card p-5', className)}>
      {(title || action) && (
        <div className="mb-3.5 flex items-center justify-between gap-3">
          {title && <h2 className="text-17 font-semibold tracking-[-0.015em] text-text">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label and value rows for a facts box. */
export function Facts({ rows, className }: { rows: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cx('space-y-3 text-14', className)}>
      {rows.map(([label, value], i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <dt className="text-faint">{label}</dt>
          <dd className="min-w-0 text-right text-text">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
