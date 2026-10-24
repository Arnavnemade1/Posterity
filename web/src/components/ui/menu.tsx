import Link from 'next/link';
import { cx } from '@/components/ui';

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-14 text-text transition-colors duration-100 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none';

/**
 * One row of a menu (inside a FloatingMenu): a link, or a button when it has `onClick`/`type`. The icon is
 * muted; `tone="danger"` is for things that end something. Rows carry role="menuitem" so arrow keys move through them.
 */
export function MenuItem({
  href,
  icon,
  hint,
  tone,
  onClick,
  type,
  className,
  children,
}: {
  href?: string;
  icon?: React.ReactNode;
  /** Quiet text at the right: a shortcut or a count. */
  hint?: React.ReactNode;
  tone?: 'danger';
  onClick?: () => void;
  type?: 'submit' | 'button';
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cx(ITEM, tone === 'danger' && 'text-danger', className);
  const body = (
    <>
      {icon && <span className="flex size-4 shrink-0 items-center justify-center text-muted [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-12 text-faint">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} role="menuitem" onClick={onClick} className={classes}>
      {body}
    </Link>
  ) : (
    <button type={type ?? 'button'} role="menuitem" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}

/** A small dim heading over a group of rows. */
export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pb-1 pt-2 text-11 font-medium uppercase tracking-[0.06em] text-faint">{children}</div>;
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1.5 my-1.5 h-px bg-line" />;
}
