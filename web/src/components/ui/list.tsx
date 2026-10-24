import Link from 'next/link';
import { cx } from '@/components/ui';

/** A list of rows with no rules between them: space and the hover tone do the separating. */
export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cx('space-y-0.5', className)}>{children}</ul>;
}

/**
 * One row: something at the left (an avatar, a status), a title with a line of meta under it, something at the
 * right. A link when it has an `href`; `selected` marks the one open in a detail pane.
 */
export function ListRow({
  href,
  leading,
  title,
  meta,
  trailing,
  selected,
  className,
  transitionTypes,
  children,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  className?: string;
  /** For `ViewTransition`: tag a drill-down with `['nav-forward']`. */
  transitionTypes?: string[];
  children?: React.ReactNode;
}) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center justify-center">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-14 font-medium text-text">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-13 text-faint">{meta}</span>}
        {children}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-13 text-faint">{trailing}</span>}
    </>
  );
  const classes = cx(
    'relative flex min-h-[52px] items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-100',
    selected ? 'bg-selected' : 'hover:bg-hover',
    selected && 'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent',
    className,
  );
  return (
    <li>
      {href ? (
        <Link href={href} transitionTypes={transitionTypes} aria-current={selected ? 'true' : undefined} className={classes}>
          {body}
        </Link>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  );
}

/** A table for dense, comparable rows. The head sticks under the page header; rows get a faint divider only here. */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-left text-14">{children}</table>
    </div>
  );
}

export function Th({ children, className, align = 'left' }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' }) {
  return (
    <th scope="col" className={cx('sticky top-[var(--sticky-top,0px)] z-[1] whitespace-nowrap border-b border-line bg-ink/90 px-3 py-2.5 text-12 font-medium text-faint backdrop-blur-md first:pl-4 last:pr-4', align === 'right' && 'text-right', className)}>
      {children}
    </th>
  );
}

export function Tr({ children, href, selected, className }: { children: React.ReactNode; href?: string; selected?: boolean; className?: string }) {
  return <tr data-href={href} aria-selected={selected} className={cx('group transition-colors duration-100 hover:bg-hover aria-selected:bg-selected', className)}>{children}</tr>;
}

export function Td({ children, className, align = 'left' }: { children?: React.ReactNode; className?: string; align?: 'left' | 'right' }) {
  return <td className={cx('border-b border-line px-3 py-3 align-middle first:pl-4 last:pr-4 group-last:border-b-0', align === 'right' && 'text-right', className)}>{children}</td>;
}

/**
 * Rows laid out on a shared grid, for lists whose items have the same few facts (a mission: status, progress,
 * lead, age). Pass the same `template` to the head and every row, spelled out in full so Tailwind sees it,
 * e.g. `md:grid-cols-[minmax(0,1fr)_140px_160px_90px]`. Below md a row stacks and the head disappears.
 */
export function DataHead({ cols, template, className }: { cols: { label: string; align?: 'right' }[]; template: string; className?: string }) {
  return (
    <div className={cx('hidden gap-4 px-3 pb-2 text-12 font-medium text-faint md:grid', template, className)} aria-hidden>
      {cols.map((c) => (
        <span key={c.label} className={c.align === 'right' ? 'text-right' : undefined}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function DataRow({ href, template, selected, transitionTypes, className, children }: { href: string; template: string; selected?: boolean; transitionTypes?: string[]; className?: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        transitionTypes={transitionTypes}
        aria-current={selected ? 'true' : undefined}
        className={cx('relative block rounded-xl px-3 py-3 transition-colors duration-100 md:grid md:items-center md:gap-4', template, selected ? 'bg-selected' : 'hover:bg-hover', className)}
      >
        {children}
      </Link>
    </li>
  );
}
