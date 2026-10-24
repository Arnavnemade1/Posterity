'use client';

import { Activity, ArrowLeftRight, Bell, Bookmark, CodeXml, Compass, House, Library, Menu as MenuIcon, MessageSquare, SlidersHorizontal, Target, Terminal, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AgentsIcon, type IconProps } from '@/components/icons';
import { useRailCollapsed } from '@/components/shell/rail-state';
import { ThemeSwitch } from '@/components/shell/theme-switch';
import { cx } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';

type Icon = React.ComponentType<IconProps>;
type Item = { href: string; label: string; icon: Icon; match?: string[]; auth?: boolean };
type Group = { label?: string; items: Item[] };

/** Every place in the app, grouped as the rail and the phone menu draw them. One name per place, here and everywhere. */
const GROUPS: Group[] = [
  {
    items: [
      { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
      { href: '/explore', label: 'Explore', icon: Compass },
      { href: '/live', label: 'Live', icon: Activity },
    ],
  },
  {
    label: 'Inbox',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell, auth: true },
      { href: '/messages', label: 'Messages', icon: MessageSquare },
      { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark, auth: true },
    ],
  },
  {
    label: 'Work',
    items: [
      { href: '/missions', label: 'Missions', icon: Target, match: ['/missions', '/tasks'] },
      { href: '/build', label: 'Workspaces', icon: CodeXml },
      { href: '/exchange', label: 'Exchange', icon: ArrowLeftRight, match: ['/exchange', '/trades'] },
      { href: '/memory', label: 'Memory', icon: Library },
    ],
  },
  {
    label: 'Fleet',
    items: [
      { href: '/control', label: 'Control room', icon: SlidersHorizontal, match: ['/control', '/dashboard', '/onboard', '/github'], auth: true },
      { href: '/agents', label: 'Agents', icon: AgentsIcon },
      { href: '/orgs', label: 'Communities', icon: Users },
      { href: '/developers', label: 'Developers', icon: Terminal, match: ['/developers', '/connect'] },
    ],
  },
];

function isActive(pathname: string, item: Item) {
  return (item.match ?? [item.href]).some((m) => pathname === m || pathname.startsWith(m.endsWith('/') ? m : `${m}/`));
}

function visible(groups: Group[], signedIn: boolean) {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => signedIn || !i.auth) }))
    .filter((g) => g.items.length);
}

// The rail is words and icons when there is room (wide, and not collapsed) and icons alone otherwise.
// That is pure CSS on the shell's data-rail, so the server draws it right the first time.
const LABEL = 'hidden min-w-0 flex-1 truncate xl:block xl:group-data-[rail=collapsed]/shell:hidden';
const ROW =
  'relative flex h-8 w-full items-center justify-center gap-2.5 rounded-lg text-14 font-medium transition-colors duration-100 xl:justify-start xl:px-2.5 xl:group-data-[rail=collapsed]/shell:justify-center xl:group-data-[rail=collapsed]/shell:px-0';

function Row({ item, active, unread, collapsed }: { item: Item; active: boolean; unread?: number; collapsed: boolean }) {
  const Icon = item.icon;
  return (
    <Tooltip content={item.label} side="right" disabled={!collapsed} className="flex w-full">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cx(
          ROW,
          active ? 'bg-active text-text before:absolute before:left-0 before:top-2 before:h-4 before:w-0.5 before:rounded-full before:bg-accent' : 'text-muted hover:bg-hover hover:text-text',
        )}
      >
        <span className="relative flex shrink-0 items-center justify-center">
          <Icon className="size-4" strokeWidth={active ? 2 : 1.75} aria-hidden />
          {Boolean(unread) && <span className="absolute -right-1 -top-1 size-2 rounded-full bg-accent ring-2 ring-surface xl:group-data-[rail=expanded]/shell:hidden" aria-hidden />}
        </span>
        <span className={LABEL}>{item.label}</span>
        {Boolean(unread) && (
          <span className="numeric hidden h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1.5 text-11 font-semibold text-accent-ink xl:flex xl:group-data-[rail=collapsed]/shell:hidden">
            {unread! > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Tooltip>
  );
}

/** The left rail's links, in groups. Group names sit above their rows when the rail is wide and a hairline divides them when it is not. */
export function NavLinks({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();
  const groups = visible(GROUPS, signedIn);
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {groups.map((group, gi) => (
        <div key={group.label ?? 'main'} className="flex flex-col gap-0.5">
          {gi > 0 && (
            <>
              <div className="mx-2 my-2 h-px bg-line xl:hidden xl:group-data-[rail=collapsed]/shell:block" aria-hidden />
              <div className="hidden px-2.5 pb-1 pt-4 text-11 font-medium uppercase tracking-[0.06em] text-faint xl:block xl:group-data-[rail=collapsed]/shell:hidden">{group.label}</div>
            </>
          )}
          {group.items.map((item) => (
            <Row key={item.href} item={item} active={isActive(pathname, item)} unread={item.href === '/notifications' ? unread : undefined} collapsed={collapsed} />
          ))}
        </div>
      ))}
    </nav>
  );
}

const TABS_SIGNED_IN: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/control', label: 'Control room', icon: SlidersHorizontal, match: ['/control', '/dashboard', '/onboard', '/github'] },
  { href: '/notifications', label: 'Notifications', icon: Bell },
];
const TABS_SIGNED_OUT: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/live', label: 'Live', icon: Activity },
  { href: '/agents', label: 'Agents', icon: AgentsIcon },
];

/** Phone navigation: four places and a menu with the rest, pinned to the bottom edge. */
export function MobileTabs({ signedIn, unread, name, email }: { signedIn: boolean; unread: number; name?: string | null; email?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = visible(GROUPS, signedIn);
  const tab = 'relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-11 font-medium';
  return (
    <>
      <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        {(signedIn ? TABS_SIGNED_IN : TABS_SIGNED_OUT).map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cx(tab, active ? 'text-text' : 'text-faint')}>
              <span className="relative">
                <Icon className="size-[20px]" strokeWidth={active ? 2.2 : 1.7} aria-hidden />
                {item.href === '/notifications' && unread > 0 && <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-accent ring-2 ring-ink" aria-hidden />}
              </span>
              {item.label.replace('Control room', 'Control')}
              {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" aria-hidden />}
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(true)} className={cx(tab, 'text-faint')} aria-haspopup="dialog">
          <MenuIcon className="size-[20px]" strokeWidth={1.7} aria-hidden />
          Menu
        </button>
      </nav>
      <Dialog open={open} onClose={() => setOpen(false)} title="Menu" variant="sheet" size="sm" hideClose>
        <div className="max-h-[78dvh] space-y-4 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3">
          {groups.map((group) => (
            <div key={group.label ?? 'main'}>
              {group.label && <div className="px-3 pb-1 text-11 font-medium uppercase tracking-[0.06em] text-faint">{group.label}</div>}
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cx('flex h-11 items-center gap-3 rounded-xl px-3 text-15 font-medium', active ? 'bg-active text-text' : 'text-muted active:bg-hover')}
                      >
                        <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
                        {item.label}
                        {item.href === '/notifications' && unread > 0 && <span className="numeric ml-auto rounded-full bg-accent px-2 text-12 font-semibold text-accent-ink">{unread}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 border-t border-line px-3 pt-4">
            <ThemeSwitch />
            {signedIn ? (
              <form action="/auth/signout" method="post" className="min-w-0">
                <button type="submit" className="truncate text-14 font-medium text-muted" title={email ?? undefined}>
                  Sign out{name ? ` · ${name}` : ''}
                </button>
              </form>
            ) : (
              <Link href="/login" onClick={() => setOpen(false)} className="text-14 font-semibold text-text">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}
