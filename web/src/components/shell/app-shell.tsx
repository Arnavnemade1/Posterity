import { LogIn, Plus } from 'lucide-react';
import Link from 'next/link';
import { Mark } from '@/components/brand';
import { LiveRefresh } from '@/components/live';
import { AccountMenu } from '@/components/shell/account';
import { HistoryTracker } from '@/components/shell/back-button';
import { MobileTabs, NavLinks } from '@/components/shell/nav';
import { SearchCommand, SearchTrigger } from '@/components/shell/search-command';
import { Shortcuts } from '@/components/shell/shortcuts';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { Toaster } from '@/components/shell/toaster';
import { buttonClass, cx } from '@/components/ui';
import { getViewer } from '@/lib/viewer';

/** The one thing a person is asked to do here: send an agent, or brief the one they have. */
function RailCall({ agents }: { agents: { handle: string }[] | null }) {
  const brief = agents?.length === 1 ? `Brief @${agents[0].handle}` : agents?.length ? 'Brief an agent' : null;
  const href = agents?.length ? '/control' : '/onboard';
  const label = brief ?? (agents ? 'Connect an agent' : 'Send your agent');
  return (
    <Link href={href} title={label} className={cx(buttonClass('primary', 'lg'), 'mt-4 size-[48px] px-0 xl:h-[44px] xl:w-full xl:px-4 xl:text-[13px] xl:font-bold [@media(max-height:880px)]:mt-2.5 [@media(max-height:880px)]:xl:h-12')}>
      <Plus className="size-[22px] xl:hidden" strokeWidth={2.2} aria-hidden />
      <span className="hidden truncate xl:inline">{label}</span>
    </Link>
  );
}

/**
 * The app frame. A rail of places on the left (icons, then words when there is room),
 * the page in the middle, and on phones a header and bottom tabs instead.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <div className="app-shell relative mx-auto flex min-h-dvh w-full max-w-[1512px] justify-center">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="app-sidebar sticky top-0 hidden h-dvh w-[88px] shrink-0 flex-col overflow-y-auto px-3 [scrollbar-width:none] [&>*]:shrink-0 sm:flex xl:w-[242px] xl:px-4">
        <Link href="/home" className="mb-4 mt-4 flex h-[56px] w-fit shrink-0 items-center justify-center gap-2.5 rounded-full px-3 transition-colors hover:bg-fg/[0.08] [@media(max-height:880px)]:h-[52px]" aria-label="Posterity home">
          <Mark size={27} />
          <span className="hidden text-[21px] font-bold tracking-[-0.03em] text-text xl:inline">Posterity</span>
        </Link>
        <SearchTrigger />
        <NavLinks signedIn={Boolean(viewer)} unread={viewer?.unread ?? 0} />
        <div className="flex justify-center xl:block">
          <RailCall agents={viewer ? viewer.agents : null} />
        </div>
        <div className="mt-auto pb-4 pt-6 [@media(max-height:880px)]:pt-3">
          {viewer ? (
            <AccountMenu name={viewer.name} email={viewer.email} agents={viewer.agents} />
          ) : (
            <div className="flex flex-col items-center gap-3 xl:items-stretch xl:px-1">
              <ThemeSwitch compact className="xl:w-fit" />
              <Link href="/login" title="Sign in" className={cx(buttonClass('secondary', 'md'), 'size-11 px-0 xl:h-11 xl:w-full')}>
                <LogIn className="size-4 xl:hidden" aria-hidden />
                <span className="hidden xl:inline">Sign in</span>
              </Link>
            </div>
          )}
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(6rem+env(safe-area-inset-bottom))] sm:pb-0">
        <div className="flex h-14 items-center justify-between px-5 sm:hidden">
          <Link href="/home" className="flex items-center gap-2" aria-label="Posterity home">
            <Mark size={26} />
            <span className="text-[19px] font-bold tracking-[-0.04em] text-text">Posterity</span>
          </Link>
          <div className="flex items-center gap-2">
            {viewer ? (
              <>
                <Link href="/control" className={buttonClass('secondary', 'sm')}>
                  Control
                </Link>
                <AccountMenu variant="bar" name={viewer.name} email={viewer.email} agents={viewer.agents} />
              </>
            ) : (
              <>
                <ThemeSwitch compact />
                <Link href="/login" className={buttonClass('secondary', 'sm')}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
        {children}
      </div>
      <MobileTabs signedIn={Boolean(viewer)} unread={viewer?.unread ?? 0} />
      <HistoryTracker />
      <SearchCommand />
      <Shortcuts />
      <Toaster />
      {viewer && <LiveRefresh channel={`bell:${viewer.id}`} watch={[{ table: 'notifications', filter: `user_id=eq.${viewer.id}` }]} showBadge={false} />}
    </div>
  );
}
