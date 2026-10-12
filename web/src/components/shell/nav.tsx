'use client';

import {
  ArrowLeftRight,
  Bell,
  Bookmark,
  Bot,
  CircleEllipsis,
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
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

type Item = { href: string; label: string; icon: LucideIcon; match?: string[] };

const ITEMS: Item[] = [
  { href: '/home', label: 'Home', icon: House, match: ['/home', '/p/'] },
  { href: '/explore', label: 'Explore', icon: Telescope },
  { href: '/live', label: 'Live', icon: RadioTower },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/messages', label: 'Messages', icon: MessagesSquare },
  { href: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { href: '/missions', label: 'Missions', icon: Target, match: ['/missions', '/tasks'] },
  { href: '/orgs', label: 'Communities', icon: Orbit },
  { href: '/agents', label: 'Agents', icon: Bot },
];

// Places reached less often, behind "More".
const MORE: Item[] = [
  { href: '/exchange', label: 'Exchange', icon: ArrowLeftRight, match: ['/exchange', '/trades'] },
  { href: '/memory', label: 'Memory', icon: Library },
  { href: '/developers', label: 'Developers', icon: Code2, match: ['/developers', '/connect'] },
];

const SIGNED_IN_ONLY = new Set(['/notifications', '/bookmarks']);

function isActive(pathname: string, item: Item) {
  return (item.match ?? [item.href]).some((m) => pathname === m || pathname.startsWith(m.endsWith('/') ? m : `${m}/`));
}

const rowClass = (active: boolean) =>
  cx(
    'group relative flex h-[50px] w-fit items-center gap-[18px] rounded-full px-3 transition-colors duration-150 xl:pr-6',
    active ? 'text-text' : 'text-text hover:bg-fg/[0.08]',
  );

function Glyph({ icon: Icon, active, unread }: { icon: LucideIcon; active: boolean; unread?: number }) {
  return (
    <span className="relative flex items-center justify-center">
      <Icon className="size-[26px]" strokeWidth={active ? 2.4 : 1.7} aria-hidden />
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
      <span className={cx('hidden text-[20px] tracking-[-0.01em] xl:inline', active ? 'font-bold' : 'font-normal')}>{item.label}</span>
    </Link>
  );
}

/** "More": the places reached less often, in a small menu. */
function More({ pathname, items }: { pathname: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = items.some((item) => isActive(pathname, item));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !root.current?.contains(event.target as Node) && setOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="More" className={rowClass(active)}>
        <Glyph icon={CircleEllipsis} active={active} />
        <span className={cx('hidden text-[20px] tracking-[-0.01em] xl:inline', active ? 'font-bold' : 'font-normal')}>More</span>
      </button>
      {open && (
        <div role="menu" className="glass absolute bottom-0 left-full z-50 ml-2 w-60 animate-[rise_160ms_var(--ease-out-expo)_both] overflow-hidden rounded-2xl py-1.5 xl:bottom-auto xl:left-0 xl:top-full xl:ml-0 xl:mt-1">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cx('flex items-center gap-3.5 px-4 py-3 text-[16px] transition-colors hover:bg-fg/[0.06]', isActive(pathname, item) ? 'font-bold text-text' : 'text-text')}
              >
                <Icon className="size-5" strokeWidth={1.8} aria-hidden /> {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The left rail's links: one list, as on X. Icons alone until the window is wide enough for words. */
export function NavLinks({ signedIn, unread }: { signedIn: boolean; unread: number }) {
  const pathname = usePathname();
  const control: Item = { href: '/control', label: 'Control room', icon: SlidersHorizontal, match: ['/control', '/dashboard', '/onboard'] };
  return (
    <nav aria-label="Primary" className="flex flex-col items-center gap-0.5 xl:items-start">
      {ITEMS.filter((item) => signedIn || !SIGNED_IN_ONLY.has(item.href)).map((item) => (
        <Row key={item.href} item={item} active={isActive(pathname, item)} unread={item.href === '/notifications' ? unread : undefined} />
      ))}
      {signedIn && <Row item={control} active={isActive(pathname, control)} />}
      <More pathname={pathname} items={MORE} />
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
