import Link from 'next/link';
import { BackButton } from '@/components/shell/back-button';
import { Tabs } from '@/components/shell/column';
import { InspectorDefault, InspectorToggle, ScrollEdge } from '@/components/shell/work-client';
import { cx } from '@/components/ui';

/**
 * The top of a work screen: where you are (a trail of places, then the title), what you can do here (actions at the
 * right) and, under it, the screen's tabs. It sticks to the top and grows a hairline only once the page has scrolled,
 * so at rest the title sits on the page rather than in a bar.
 */
export function PageHeader({
  title,
  crumbs,
  back,
  meta,
  actions,
  tabs,
  tabsSlot,
  inspector = false,
}: {
  title: React.ReactNode;
  /** The places above this one, nearest last. */
  crumbs?: { label: string; href: string }[];
  /** Where "back" goes when there is no history to return to. Defaults to the last crumb. */
  back?: string;
  /** Quiet text after the title: a count, a status, a time. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: { items: { href: string; label: React.ReactNode; active: boolean }[]; label: string };
  /** Tabs that work out their own active state in the browser (a layout cannot see the URL). */
  tabsSlot?: React.ReactNode;
  /** Offer the button that shows and hides the inspector. */
  inspector?: boolean;
}) {
  const fallback = back ?? crumbs?.[crumbs.length - 1]?.href;
  return (
    <header data-scrolled="false" className="sticky top-[var(--app-bar-h)] z-20 border-b border-transparent bg-ink/85 backdrop-blur-xl transition-colors duration-150 data-[scrolled=true]:border-line">
      <ScrollEdge />
      <div className="flex min-h-[var(--column-header-h)] items-center gap-3 px-4 sm:px-5">
        {fallback && <BackButton fallback={fallback} />}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {crumbs?.map((c) => (
            <span key={c.href} className="hidden shrink-0 items-center gap-2 sm:flex">
              <Link href={c.href} className="text-14 text-faint transition-colors hover:text-text">
                {c.label}
              </Link>
              <span className="text-faint/70" aria-hidden>
                /
              </span>
            </span>
          ))}
          <h1 className="truncate text-17 font-semibold tracking-[-0.015em] text-text">{title}</h1>
          {meta && <span className="hidden shrink-0 items-center gap-2 text-13 text-faint sm:flex">{meta}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {inspector && <InspectorToggle />}
        </div>
      </div>
      {tabs && <Tabs items={tabs.items} label={tabs.label} align="start" />}
      {tabsSlot}
    </header>
  );
}

/** A row under the header for the controls that narrow what is below: a search, filters, a view switch. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5', className)}>{children}</div>;
}

/**
 * The body of a work screen: the content, and optionally an inspector beside it. The inspector is the "details"
 * pane: facts and controls for the thing on the left. From xl it is a sticky 340px column with its own scroll;
 * below that it stacks under the content. The header's toggle hides it.
 */
export function WorkBody({ children, inspector, className, closedOn }: { children: React.ReactNode; inspector?: React.ReactNode; className?: string; closedOn?: string }) {
  if (!inspector) return <div className={className}>{children}</div>;
  return (
    <div data-inspector="open" className="group/work xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:data-[inspector=closed]:grid-cols-[minmax(0,1fr)_0px]">
      {closedOn && <InspectorDefault closedOn={closedOn} />}
      <div className={cx('min-w-0', className)}>{children}</div>
      <aside
        aria-label="Details"
        className="border-t border-line xl:sticky xl:top-[var(--column-header-h)] xl:h-[calc(100dvh-var(--column-header-h))] xl:overflow-y-auto xl:border-l xl:border-t-0 xl:group-data-[inspector=closed]/work:hidden"
      >
        {inspector}
      </aside>
    </div>
  );
}

/** A titled group inside an inspector or a page body. */
export function Block({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('px-4 py-4 sm:px-5', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-13 font-semibold text-muted">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
