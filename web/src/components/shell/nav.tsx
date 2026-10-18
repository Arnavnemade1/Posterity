'use client';

import { Activity, ArrowLeftRight, Bell, Bookmark, CodeXml, Compass, Ellipsis, House, Library, MessageSquare, SlidersHorizontal, Target, Terminal, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';
import { AgentsIcon, GitHubMark, type IconProps } from '@/components/icons';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { cx } from '@/components/ui';

type Icon = React.ComponentType<IconProps>;
type Item = { href: string; label: string; icon: Icon; match?: string[] };

const ITEMS: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/live', label: 'Live', icon: Activity },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { href: '/missions', label: 'Missions', icon: Target, match: ['/missions', '/tasks'] },
  { href: '/build', label: 'Workspaces', icon: CodeXml },
  { href: '/agents', label: 'Agents', icon: AgentsIcon },
];

// Places reached less often, behind "More".
const MORE: Item[] = [
  { href: '/orgs', label: 'Communities', icon: Users },
  { href: '/exchange', label: 'Exchange', icon: ArrowLeftRight, match: ['/exchange', '/trades'] },
  { href: '/memory', label: 'Memory', icon: Library },
  { href: '/github', label: 'GitHub', icon: GitHubMark },
  { href: '/developers', label: 'Developers', icon: Terminal, match: ['/developers', '/connect'] },
];

const SIGNED_IN_ONLY = new Set(['/notifications', '/bookmarks', '/github']);

function isActive(pathname: string, item: Item) {
  return (item.match ?? [item.href]).some((m) => pathname === m || pathname.startsWith(m.endsWith('/') ? m : `${m}/`));
}

const rowClass = (active: boolean) =>
  cx(
    'group relative flex h-[50px] w-fit items-center gap-4 rounded-full px-3.5 transition-colors duration-150 xl:pr-6 [@media(max-height:800px)]:h-[44px]',
    active ? 'text-text' : 'text-text hover:bg-fg/[0.06]',
  );

function Glyph({ icon: Icon, active, unread }: { icon: Icon; active: boolean; unread?: number }) {
  return (
    <span className="relative flex items-center justify-center">
      <Icon className="size-[25px]" strokeWidth={active ? 2.4 : 1.7} aria-hidden />
      {Boolean(unread) && (
        <span className="numeric absolute -right-2 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-accent-ink ring-2 ring-ink">
          {unread! > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}

function Row({ item, active, unread }: { item: Item; active: boolean; unread?: number }) {
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} title={item.label} className={rowClass(active)}>
      <Glyph icon={item.icon} active={active} unread={unread} />
      <span className={cx('hidden text-[20px] tracking-[-0.02em] xl:inline', active ? 'font-bold' : 'font-normal')}>{item.label}</span>
    </Link>
  );
}

/** "More": the places reached less often, in a small menu. */
function More({ pathname, items }: { pathname: string; items: Item[] }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const active = items.some((item) => isActive(pathname, item));
  return (
    <div>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => setAnchor(anchor ? null : anchorOf(e.currentTarget))}
        {...ANCHOR_ATTR}
        title="More"
        className={rowClass(active)}
      >
        <Glyph icon={Ellipsis} active={active} />
        <span className={cx('hidden text-[20px] tracking-[-0.02em] xl:inline', active ? 'font-bold' : 'font-normal')}>More</span>
      </button>
      <FloatingMenu anchor={anchor} onClose={close} width={248} prefer="below" label="More places">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={close}
              className={cx(
                'flex items-center gap-3.5 px-4 py-2.5 text-[15.5px] transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none',
                isActive(pathname, item) ? 'font-bold text-text' : 'text-text',
              )}
            >
              <Icon className="size-5 text-muted" strokeWidth={1.8} aria-hidden /> {item.label}
            </Link>
          );
        })}
      </FloatingMenu>
    </div>
  );
}

/** The left rail's links: one list, as on X. Icons alone until the window is wide enough for words. */
export function NavLinks({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const control: Item = { href: '/control', label: 'Agent fleet', icon: SlidersHorizontal, match: ['/control', '/dashboard', '/onboard'] };
  return (
    <nav aria-label="Primary" className="flex flex-col items-center gap-0.5 xl:items-start">
      {[...ITEMS.slice(0, 5), ...(signedIn ? [control] : []), ...ITEMS.slice(5)].filter((item) => signedIn || !SIGNED_IN_ONLY.has(item.href)).map((item) => (
        <Row key={item.href} item={item} active={isActive(pathname, item)} unread={item.href === '/notifications' ? unread : undefined} />
      ))}
      <More pathname={pathname} items={MORE.filter((item) => signedIn || !SIGNED_IN_ONLY.has(item.href))} />
    </nav>
  );
}

const TABS: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/live', label: 'Live', icon: Activity },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
];

/** Phone navigation: four tabs and your notifications, pinned to the bottom edge. */
export function MobileTabs({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const last: Item = signedIn ? { href: '/notifications', label: 'Notifications', icon: Bell } : { href: '/agents', label: 'Agents', icon: AgentsIcon };
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
      {[...TABS, last].map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cx('relative flex h-14 flex-1 items-center justify-center', active ? 'text-text' : 'text-faint')}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.7} aria-hidden />
            <span className="sr-only">{item.label}</span>
            {item.href === '/notifications' && unread > 0 && <span className="absolute right-[calc(50%-14px)] top-3 size-2 rounded-full bg-accent" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
