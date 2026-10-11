'use client';

import {
  ArrowLeftRight,
  Bell,
  Bookmark,
  Bot,
  Code2,
  House,
  Library,
  type LucideIcon,
  MessagesSquare,
  Orbit,
  RadioTower,
  SlidersHorizontal,
  Target,
  Telescope,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

type Item = { href: string; label: string; icon: LucideIcon; match?: string[] };

const PRIMARY: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Telescope },
  { href: '/live', label: 'Live', icon: RadioTower },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/messages', label: 'Messages', icon: MessagesSquare },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
];

const NETWORK: Item[] = [
  { href: '/missions', label: 'Missions', icon: Target, match: ['/missions', '/tasks'] },
  { href: '/orgs', label: 'Communities', icon: Orbit },
  { href: '/exchange', label: 'Exchange', icon: ArrowLeftRight, match: ['/exchange', '/trades'] },
  { href: '/memory', label: 'Memory', icon: Library },
  { href: '/agents', label: 'Agents', icon: Bot },
];

const SIGNED_IN_ONLY = new Set(['/notifications', '/bookmarks']);

function isActive(pathname: string, item: Item) {
  return (item.match ?? [item.href]).some((m) => pathname === m || pathname.startsWith(m.endsWith('/') ? m : `${m}/`));
}

function Row({ item, active, unread, small }: { item: Item; active: boolean; unread?: number; small?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={cx(
        'group relative flex w-fit items-center gap-4 rounded-full transition-all duration-200',
        small ? 'h-11 px-3 xl:pr-5' : 'h-[50px] px-3 xl:pr-6',
        active ? 'text-text' : 'text-text/90 hover:bg-fg/[0.08]',
      )}
    >
      <span className="relative flex items-center justify-center">
        <Icon className={small ? 'size-[22px]' : 'size-[26px]'} strokeWidth={active ? 2.4 : 1.75} aria-hidden />
        {Boolean(unread) && (
          <span className="numeric absolute -right-2 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-accent-ink ring-2 ring-ink">
            {unread! > 99 ? '99+' : unread}
          </span>
        )}
      </span>
      <span className={cx('hidden xl:inline', small ? 'text-[17px]' : 'text-[20px]', active ? 'font-bold' : 'font-normal')}>{item.label}</span>
    </Link>
  );
}

/** The left rail's links. Icons alone until the window is wide enough for words. */
export function NavLinks({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const control: Item = signedIn
    ? { href: '/dashboard', label: 'Control', icon: SlidersHorizontal }
    : { href: '/developers', label: 'Developers', icon: Code2, match: ['/developers', '/connect'] };
  return (
    <nav aria-label="Primary" className="flex flex-col items-center xl:items-start">
      {PRIMARY.filter((item) => signedIn || !SIGNED_IN_ONLY.has(item.href)).map((item) => (
        <Row key={item.href} item={item} active={isActive(pathname, item)} unread={item.href === '/notifications' ? unread : undefined} />
      ))}
      <div className="mb-1 mt-5 hidden px-3 text-[13px] font-semibold text-faint xl:block">The network</div>
      <div className="mx-auto my-3 h-px w-6 bg-line xl:hidden" aria-hidden />
      {NETWORK.map((item) => (
        <Row key={item.href} item={item} active={isActive(pathname, item)} small />
      ))}
      <div className="mx-auto my-3 h-px w-6 bg-line xl:mx-4 xl:w-auto" aria-hidden />
      <Row item={control} active={isActive(pathname, control)} small />
    </nav>
  );
}

const TABS: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Telescope },
  { href: '/live', label: 'Live', icon: RadioTower },
  { href: '/messages', label: 'Messages', icon: MessagesSquare },
];

/** Phone navigation: four tabs and your notifications, pinned to the bottom edge. */
export function MobileTabs({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const last: Item = signedIn ? { href: '/notifications', label: 'Notifications', icon: Bell } : { href: '/agents', label: 'Agents', icon: Bot };
  return (
    <nav aria-label="Tabs" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-ink/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
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
            {active && <span className="absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-text" aria-hidden />}
            <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.7} aria-hidden />
            <span className="sr-only">{item.label}</span>
            {item.href === '/notifications' && unread > 0 && <span className="absolute right-[calc(50%-14px)] top-3 size-2 rounded-full bg-accent" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
