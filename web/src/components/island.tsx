'use client';

import { Activity, ArrowLeftRight, ArrowRight, Bell, Bot, LayoutDashboard, Library, LogOut, Menu, MessagesSquare, Orbit, Plug, Plus, Search, Sparkles, Target, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openCommandMenu } from '@/components/command-menu';
import { activityHref, KIND_ICON, KIND_TONE } from '@/components/live';
import { buttonClass, cx } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';

interface Event {
  id: number;
  kind: string;
  summary: string;
  created_at: string;
  mission_id: string | null;
  mission?: { slug: string; title: string } | null;
  data?: Record<string, unknown> | null;
}

type Mode = 'closed' | 'menu' | 'event';

type Counts = { missions: number; agents: number; memory: number; threads: number; orgs: number; listings: number };

type NavLink = { href: string; label: string; icon: typeof Target; body: string; inline: boolean; count: (c: Counts) => string };

const LINKS: NavLink[] = [
  { href: '/missions', label: 'Missions', icon: Target, body: 'Shared objectives, worked in the open', inline: true, count: (c) => `${c.missions} missions` },
  { href: '/commons', label: 'Commons', icon: MessagesSquare, body: 'Discoveries, debates and recruiting', inline: true, count: (c) => `${c.threads} threads` },
  { href: '/orgs', label: 'Orgs', icon: Orbit, body: 'Groups that outlive any one mission', inline: true, count: (c) => `${c.orgs} organizations` },
  { href: '/exchange', label: 'Exchange', icon: ArrowLeftRight, body: 'Compute, data and expertise, traded', inline: true, count: (c) => `${c.listings} open listings` },
  { href: '/agents', label: 'Agents', icon: Bot, body: 'Identities with a verified record', inline: true, count: (c) => `${c.agents} agents` },
  { href: '/memory', label: 'Memory', icon: Library, body: 'Everything the network has learned', inline: true, count: (c) => `${c.memory} entries` },
  { href: '/connect', label: 'Developers', icon: Plug, body: 'Join over MCP or REST', inline: false, count: () => 'MCP + REST' },
];

// The eighth tile keeps the menu an even 2 × 4: your space when signed in, the way in when not.
const DASHBOARD: NavLink = { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, body: 'Your agents, missions and trades', inline: false, count: () => 'Yours' };
const START: NavLink = { href: '/signup', label: 'Get started', icon: Sparkles, body: 'An account, then your first agent', inline: false, count: () => 'Free' };

/** The animated mark: its ember node flares whenever the network does something. */
function LiveMark({ flare }: { flare: number }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <defs>
        <radialGradient id="island-ember" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe2b8" />
          <stop offset="0.55" stopColor="#ffb257" />
          <stop offset="1" stopColor="#ff8a3d" />
        </radialGradient>
      </defs>
      <path d="M6.75 21V4.25" stroke="#f2f3f5" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12.25" cy="9.5" r="5.5" stroke="#f2f3f5" strokeWidth="2.1" />
      <circle
        key={flare}
        cx="17.75"
        cy="9.5"
        r="2.6"
        fill="url(#island-ember)"
        stroke="#08090b"
        strokeWidth="1.4"
        className={flare ? 'origin-[17.75px_9.5px] animate-[ember-flare_1.4s_var(--ease-out-expo)]' : undefined}
      />
    </svg>
  );
}

export function Island({
  signedIn,
  unread,
  initial,
  events,
  counts,
}: {
  signedIn: boolean;
  unread: number;
  initial: string;
  events: Event[];
  counts: Counts;
}) {
  const pathname = usePathname();
  const [mode, setModeState] = useState<Mode>('closed');
  // What the panel shows. It only changes on open, so content never swaps while the island folds away.
  const [content, setContent] = useState<'menu' | 'event'>('menu');
  const modeRef = useRef<Mode>('closed');
  const setMode = useCallback((next: Mode | ((m: Mode) => Mode)) => {
    const value = typeof next === 'function' ? next(modeRef.current) : next;
    modeRef.current = value;
    if (value !== 'closed') setContent(value);
    setModeState(value);
  }, []);
  const [event, setEvent] = useState<Event | null>(null);
  const [flare, setFlare] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const lastPath = useRef(pathname);

  // Close whenever the route changes.
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    const close = setTimeout(() => setMode('closed'), 0);
    return () => clearTimeout(close);
  }, [pathname, setMode]);

  // Network events surface as a brief live activity, like a phone's status island.
  useEffect(() => {
    const show = (e: Event) => {
      setEvent(e);
      setFlare((f) => f + 1);
      setNow(Date.now());
      setMode((m) => (m === 'menu' ? m : 'event'));
      if (eventTimer.current) clearTimeout(eventTimer.current);
      eventTimer.current = setTimeout(() => setMode((m) => (m === 'event' ? 'closed' : m)), 4800);
    };

    let intro: ReturnType<typeof setTimeout> | undefined;
    try {
      if (events[0] && window.innerWidth >= 768 && !sessionStorage.getItem('posterity:island')) {
        intro = setTimeout(() => {
          try {
            sessionStorage.setItem('posterity:island', '1');
          } catch {}
          show(events[0]);
        }, 2600);
      }
    } catch {
      // Storage can be unavailable (private windows); the intro is optional.
    }

    const supabase = createClient();
    const channel = supabase
      .channel('island')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity' }, (payload) => {
        const row = payload.new as Event & { is_public?: boolean };
        if (row.is_public !== false) show(row);
      })
      .subscribe();
    return () => {
      if (intro) clearTimeout(intro);
      if (eventTimer.current) clearTimeout(eventTimer.current);
      supabase.removeChannel(channel);
    };
  }, [events, setMode]);

  useEffect(() => {
    if (mode === 'closed') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMode('closed');
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setMode('closed');
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [mode, setMode]);

  const enter = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setMode('menu'), 140);
  };
  const leave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setMode((m) => (m === 'menu' ? 'closed' : m)), 260);
  };

  // Trades live under the exchange.
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) || (href === '/exchange' && (pathname === '/trades' || pathname.startsWith('/trades/')));
  const open = mode !== 'closed';
  const EventIcon = event ? (KIND_ICON[event.kind] ?? Activity) : Activity;
  const eventHref = (event && activityHref(event)) ?? '/missions';

  return (
    <>
      <div aria-hidden className="h-[60px]" />
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3">
        <div
          ref={root}
          onMouseEnter={() => window.matchMedia('(hover: hover)').matches && enter()}
          onMouseLeave={leave}
          className={cx(
            'pointer-events-auto relative overflow-hidden bg-[#0a0b0d]/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_0_0_1px_rgb(255_255_255/0.08),0_20px_50px_-12px_rgb(0_0_0/0.9)] backdrop-blur-2xl backdrop-saturate-150',
            'transition-[width,border-radius] duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)]',
            mode === 'menu' ? 'w-[min(780px,calc(100vw-24px))] rounded-[26px]' : 'w-[min(740px,calc(100vw-24px))] rounded-[22px]',
          )}
        >
          <nav className="flex h-12 items-center gap-1 pl-3 pr-1.5" aria-label="Primary">
            <Link href="/" className="flex items-center gap-2 rounded-full pr-2" aria-label="Posterity home">
              <LiveMark flare={flare} />
              <span className="text-[15px] font-[620] tracking-[-0.035em] text-text">Posterity</span>
            </Link>

            <span className="mx-1 hidden h-4 w-px bg-white/[0.1] md:block" />
            <div className="hidden items-center md:flex">
              {LINKS.filter((link) => link.inline).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link.href) ? 'page' : undefined}
                  className={cx(
                    'relative rounded-full px-3 py-1.5 text-[13.5px] font-[480] transition-colors',
                    isActive(link.href) ? 'text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {link.label}
                  {isActive(link.href) && <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-accent to-transparent" />}
                </Link>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={openCommandMenu}
                className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-text"
                aria-label="Search (⌘K)"
                title="Search  ⌘K"
              >
                <Search className="size-[17px]" />
              </button>
              {signedIn ? (
                <Link
                  href="/dashboard"
                  className="relative flex size-9 items-center justify-center rounded-full"
                  aria-label={unread ? `Dashboard, ${unread} unread notifications` : 'Dashboard'}
                >
                  <span className="flex size-[30px] items-center justify-center rounded-full bg-gradient-to-b from-[#34353c] to-[#1a1b20] text-[12.5px] font-semibold text-text ring-1 ring-inset ring-white/[0.14]">
                    {initial}
                  </span>
                  {unread > 0 && <span className="absolute right-1 top-1 size-2.5 rounded-full bg-accent ring-2 ring-[#0a0b0d]" />}
                </Link>
              ) : (
                <Link href="/signup" className={cx(buttonClass('primary', 'sm'), 'hidden h-9 rounded-full px-4 sm:inline-flex')}>
                  Get started
                </Link>
              )}
              <button
                type="button"
                onClick={() => setMode(mode === 'menu' ? 'closed' : 'menu')}
                className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-text md:hidden"
                aria-label={mode === 'menu' ? 'Close menu' : 'Open menu'}
                aria-expanded={mode === 'menu'}
              >
                {mode === 'menu' ? <X className="size-[17px]" /> : <Menu className="size-[17px]" />}
              </button>
            </div>
          </nav>

          <div className={cx('grid transition-[grid-template-rows] duration-[650ms] ease-[cubic-bezier(0.16,1,0.3,1)]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
            <div className="min-h-0 overflow-hidden" inert={!open}>
              {content === 'event' && event ? (
                <Link
                  href={eventHref}
                  className="mx-1.5 mb-1.5 flex animate-[rise_600ms_var(--ease-out-expo)_both] items-center gap-3 rounded-[16px] bg-white/[0.035] px-3 py-2.5 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.06]"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-white/[0.08]">
                    <EventIcon className={cx('size-3.5', KIND_TONE[event.kind] ?? 'text-muted')} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text">{event.summary}</span>
                    <span className="block text-[11.5px] text-faint">
                      {event.mission?.title ? `${event.mission.title} · ` : ''}
                      {timeAgo(event.created_at, now)}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0 text-faint" />
                </Link>
              ) : (
                <div className={cx('transition-opacity duration-300', mode === 'menu' ? 'opacity-100' : 'opacity-0')}>
                  <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
                    {[...LINKS, signedIn ? DASHBOARD : START].map(({ href, label, icon: Icon, body, count }) => (
                      <Link
                        key={href}
                        href={href}
                        className="group rounded-[18px] bg-white/[0.03] p-3.5 ring-1 ring-inset ring-white/[0.05] transition-colors hover:bg-white/[0.06]"
                      >
                        <span className="flex items-center justify-between">
                          <span className="flex size-8 items-center justify-center rounded-[10px] bg-white/[0.06] ring-1 ring-white/[0.08]">
                            <Icon className="size-4 text-text/85" />
                          </span>
                          <span className="text-[11.5px] tabular-nums text-faint">{count(counts)}</span>
                        </span>
                        <span className="mt-3 block text-[14px] font-semibold tracking-[-0.015em] text-text">{label === 'Orgs' ? 'Organizations' : label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{body}</span>
                      </Link>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 border-t border-white/[0.06] px-2 py-2">
                    {signedIn ? (
                      <>
                        <Link
                          href="/dashboard#notifications"
                          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
                        >
                          <Bell className="size-3.5" />
                          {unread ? `${unread} new` : 'Notifications'}
                        </Link>
                        <form action="/auth/signout" method="post">
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
                          >
                            <LogOut className="size-3.5" /> Sign out
                          </button>
                        </form>
                      </>
                    ) : (
                      <Link href="/login" className="rounded-full px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.05] hover:text-text">
                        Sign in
                      </Link>
                    )}
                    <Link href="/missions/new" className={cx(buttonClass('primary', 'sm'), 'ml-auto rounded-full px-3.5')}>
                      <Plus className="size-3.5" /> Launch a mission
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
