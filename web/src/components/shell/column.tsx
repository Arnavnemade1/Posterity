import Link from 'next/link';
import { BackButton } from '@/components/shell/back-button';
import { cx } from '@/components/ui';

/**
 * A page inside the app: the centre column, and the right rail beside it on wide screens.
 * `wide` pages (mission graphs, task rooms, messages) take the rail's space instead.
 */
export function Page({ children, rail, wide = false, fixed = false }: { children: React.ReactNode; rail?: React.ReactNode; wide?: boolean; fixed?: boolean }) {
  return (
    <div className="flex w-full min-w-0 justify-center lg:gap-6 xl:justify-start">
      <main
        id="main"
        className={cx(
          'w-full min-w-0 border-line sm:border-x',
          // A fixed page is exactly one screen tall (less the phone's top bar and tabs) and its panes scroll on their own.
          fixed ? 'h-[calc(100dvh-7.5rem)] overflow-hidden sm:h-dvh' : 'min-h-dvh',
          wide ? (fixed ? 'max-w-[1010px]' : 'max-w-[1180px]') : 'max-w-[680px]',
        )}
      >
        {children}
      </main>
      {rail && !wide && (
        <aside aria-label="Around the network" className="hidden w-[290px] shrink-0 lg:block xl:w-[304px]">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-5 overflow-y-auto px-1 py-6 [scrollbar-width:none] [&>*]:shrink-0">{rail}</div>
        </aside>
      )}
    </div>
  );
}

/** The sticky top of a column: its title, an optional way back, and tabs. */
export function ColumnHeader({
  title,
  subtitle,
  back,
  right,
  children,
  visuallyHiddenTitle = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Where "back" goes when there is no history to return to. */
  back?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  visuallyHiddenTitle?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/75 backdrop-blur-xl backdrop-saturate-150">
      <div className={cx('flex min-h-[84px] items-center gap-3 px-5 sm:px-6', visuallyHiddenTitle && 'sr-only')}>
        {back && <BackButton fallback={back} />}
        <div className="min-w-0 flex-1 py-1.5">
          <h1 className="truncate text-[23px] font-semibold leading-tight tracking-[-0.02em] text-text">{title}</h1>
          {subtitle && <div className="mt-0.5 truncate text-[13px] text-faint">{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

/** Link tabs under a column header. The active one carries the ember rule. */
export function Tabs({ items, label }: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="flex overflow-x-auto [scrollbar-width:none]">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className="group relative flex h-[46px] min-w-fit flex-1 items-center justify-center px-4 text-[13px] transition-colors hover:bg-fg/[0.04]"
        >
          <span className={cx('relative flex h-full items-center whitespace-nowrap', item.active ? 'font-bold text-text' : 'font-medium text-faint group-hover:text-muted')}>
            {item.label}
            {item.active && <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent" aria-hidden />}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** A titled block in the right rail. */
export function RailSection({ title, href, action, children, className }: { title: string; href?: string; action?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('card overflow-hidden', className)}>
      <h2 className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-3.5">
        <span className="text-[14px] font-semibold tracking-[-0.01em] text-text">{title}</span>
      </h2>
      {children}
      {href && (
        <Link href={href} className="block px-4 py-3.5 text-[12px] text-open transition-colors hover:bg-fg/[0.04]">
          {action ?? 'Show more'}
        </Link>
      )}
    </section>
  );
}

/** An empty column: a short line of copy under a small chart of nothing. */
export function ColumnEmpty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="px-8 py-16 text-center">
      <p className="text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-text">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-faint">{children}</div>}
      {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
