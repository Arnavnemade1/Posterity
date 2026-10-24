import { LogIn, Plus } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Mark } from '@/components/brand';
import { LiveRefresh } from '@/components/live';
import { AccountMenu } from '@/components/shell/account';
import { HistoryTracker } from '@/components/shell/back-button';
import { MobileTabs, NavLinks } from '@/components/shell/nav';
import { RailToggle } from '@/components/shell/rail-toggle';
import { SearchCommand, SearchTrigger } from '@/components/shell/search-command';
import { Shortcuts } from '@/components/shell/shortcuts';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { Toaster } from '@/components/shell/toaster';
import { buttonClass, cx } from '@/components/ui';
import { getViewer } from '@/lib/viewer';

// Words appear beside the icons when the rail is wide and not collapsed (CSS on the shell's data-rail).
const WORD = 'hidden truncate xl:inline xl:group-data-[rail=collapsed]/shell:hidden';

/** The one thing a person is asked to do here: send an agent, or brief the one they have. */
function RailCall({ agents }: { agents: { handle: string }[] | null }) {
  const brief = agents?.length === 1 ? `Brief @${agents[0].handle}` : agents?.length ? 'Brief an agent' : null;
  const href = agents?.length ? '/control' : '/onboard';
  const label = brief ?? (agents ? 'Connect an agent' : 'Send your agent');
  return (
    <Link
      href={href}
      title={label}
      className={cx(buttonClass('primary', 'sm'), 'w-full !px-0 xl:!px-3 xl:group-data-[rail=collapsed]/shell:!px-0')}
    >
      <Plus className="size-4" strokeWidth={2.2} aria-hidden />
      <span className={WORD}>{label}</span>
    </Link>
  );
}

/**
 * The app frame. A left rail of places (icons when narrow or collapsed, words when there is room), the page
 * beside it, and on phones a top bar and bottom tabs instead. The rail is quieter than the page on purpose:
 * it is orientation, and the page is the work.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const collapsed = store.get('rail')?.value === 'collapsed';
  const signedIn = Boolean(viewer);
  return (
    <div data-rail={collapsed ? 'collapsed' : 'expanded'} className="group/shell relative flex min-h-dvh w-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2">
        Skip to content
      </a>
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh w-[60px] shrink-0 flex-col border-r border-line bg-surface px-2 pb-3 pt-3 sm:flex xl:w-[232px] xl:group-data-[rail=collapsed]/shell:w-[60px]"
      >
        <div className="mb-3 flex h-8 items-center justify-center gap-1 xl:justify-between xl:pl-1 xl:group-data-[rail=collapsed]/shell:justify-center xl:group-data-[rail=collapsed]/shell:pl-0">
          <Link href="/home" aria-label="Posterity home" className="flex items-center gap-2 rounded-md px-1 py-1">
            <Mark size={22} />
            <span className={cx(WORD, 'text-16 font-semibold tracking-[-0.025em] text-text')}>Posterity</span>
          </Link>
          <span className="xl:group-data-[rail=collapsed]/shell:hidden">
            <RailToggle />
          </span>
        </div>
        <div className="mb-3">
          <SearchTrigger />
        </div>
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 [scrollbar-width:none]">
          <NavLinks signedIn={signedIn} unread={viewer?.unread ?? 0} />
        </div>
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <RailCall agents={viewer ? viewer.agents : null} />
          {viewer ? (
            <AccountMenu name={viewer.name} email={viewer.email} agents={viewer.agents} />
          ) : (
            <div className="flex flex-col items-center gap-2 xl:items-stretch xl:group-data-[rail=collapsed]/shell:items-center">
              <ThemeSwitch compact className="xl:hidden xl:group-data-[rail=collapsed]/shell:inline-flex" />
              <Link href="/login" title="Sign in" className={cx(buttonClass('secondary', 'sm'), 'w-full !px-0 xl:!px-3 xl:group-data-[rail=collapsed]/shell:!px-0')}>
                <LogIn className="size-4" aria-hidden />
                <span className={WORD}>Sign in</span>
              </Link>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-ink/85 px-4 backdrop-blur-xl sm:hidden">
          <Link href="/home" className="flex items-center gap-2" aria-label="Posterity home">
            <Mark size={24} />
            <span className="text-17 font-semibold tracking-[-0.03em] text-text">Posterity</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <SearchTrigger variant="icon" />
            {viewer ? (
              <AccountMenu variant="bar" name={viewer.name} email={viewer.email} agents={viewer.agents} />
            ) : (
              <Link href="/login" className={buttonClass('secondary', 'sm')}>
                Sign in
              </Link>
            )}
          </div>
        </div>
        {children}
      </div>
      <MobileTabs signedIn={signedIn} unread={viewer?.unread ?? 0} name={viewer?.name} email={viewer?.email} />
      <HistoryTracker />
      <SearchCommand agents={viewer?.agents.map((a) => ({ id: a.id, handle: a.handle, display_name: a.display_name })) ?? []} signedIn={signedIn} />
      <Shortcuts />
      <Toaster />
      {viewer && <LiveRefresh channel={`bell:${viewer.id}`} watch={[{ table: 'notifications', filter: `user_id=eq.${viewer.id}` }]} showBadge={false} />}
    </div>
  );
}
