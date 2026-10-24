import Link from 'next/link';
import { ViewTransition } from 'react';
import { PageTransition } from '@/components/motion';
import { BackButton } from '@/components/shell/back-button';
import { cx, EmptyState } from '@/components/ui';

/**
 * A page inside the app. Two frames share this name:
 *  - the feed frame (default): a centred column of posts with a slim rail beside it on wide screens, for
 *    Home, Explore, a thread, bookmarks;
 *  - the work frame (`wide`): the full width of the content area, for missions, workspaces, the control room
 *    and everything else that is a screen of work rather than a stream. `fixed` pins it to one screen tall
 *    for two-pane layouts (messages) that scroll inside; `full` lifts the 1200px cap for screens that want
 *    every pixel (code and diffs).
 */
export function Page({ children, rail, wide = false, fixed = false, full = false }: { children: React.ReactNode; rail?: React.ReactNode; wide?: boolean; fixed?: boolean; full?: boolean }) {
  if (wide) {
    return (
      <PageTransition>
        <main
          id="main"
          className={cx(
            'w-full min-w-0',
            // A fixed page is exactly one screen tall (less the phone's top bar and tabs) and its panes scroll on their own.
            fixed ? 'h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] overflow-hidden sm:h-dvh' : cx('min-h-dvh', !full && 'mx-auto max-w-[1200px]'),
          )}
        >
          {children}
        </main>
      </PageTransition>
    );
  }
  return (
    <div className="flex w-full min-w-0 justify-center gap-6 min-[1100px]:px-4">
      <PageTransition>
        <main id="main" className="min-h-dvh w-full min-w-0 max-w-[640px] border-line sm:border-x">
          {children}
        </main>
      </PageTransition>
      {rail && (
        <aside aria-label="Around the network" className="hidden w-[300px] shrink-0 min-[1100px]:block">
          <div className="sticky top-0 flex max-h-dvh flex-col gap-6 overflow-y-auto py-4 [scrollbar-width:none] [&>*]:shrink-0">{rail}</div>
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
    <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur-xl">
      <div className={cx('flex min-h-[var(--column-header-h)] items-center gap-3 px-4', visuallyHiddenTitle && 'sr-only')}>
        {back && <BackButton fallback={back} />}
        <div className="min-w-0 flex-1 py-1.5">
          <h1 className="truncate text-17 font-semibold leading-tight tracking-[-0.015em] text-text">{title}</h1>
          {subtitle && <div className="truncate text-13 text-faint">{subtitle}</div>}
        </div>
        {right}
      </div>
      {children}
    </header>
  );
}

/** Link tabs under a column header. The active tab carries a short gold underline that slides to the next. */
export function Tabs({ items, label, align = 'stretch' }: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string; align?: 'stretch' | 'start' }) {
  const name = `tabs-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <nav aria-label={label} className={cx('flex overflow-x-auto [scrollbar-width:none]', align === 'start' && 'gap-1 px-2 sm:px-3')}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={cx('group relative flex h-[var(--column-tabs-h)] min-w-fit items-center justify-center px-4 text-14 transition-colors duration-100 hover:bg-hover', align === 'stretch' ? 'flex-1' : 'rounded-lg')}
        >
          <span className={cx('relative flex h-full items-center whitespace-nowrap', item.active ? 'font-semibold text-text' : 'font-medium text-faint group-hover:text-muted')}>
            {item.label}
            {item.active && (
              <ViewTransition name={name} share="tab-indicator" default="none" enter="none" exit="none">
                <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden />
              </ViewTransition>
            )}
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** A titled block in the right rail: a quiet heading, rows with hover tone, no card around it. */
export function RailSection({ title, href, action, children, className }: { title: string; href?: string; action?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="px-2.5 pb-1 text-13 font-semibold text-muted">{title}</h2>
      {children}
      {href && (
        <Link href={href} className="mt-0.5 block rounded-lg px-2.5 py-2 text-13 text-link transition-colors hover:bg-hover">
          {action ?? 'Show more'}
        </Link>
      )}
    </section>
  );
}

/** An empty column: one line that says what this place is for, and what to do about it. */
export function ColumnEmpty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <EmptyState title={title} action={action}>
      {children}
    </EmptyState>
  );
}
