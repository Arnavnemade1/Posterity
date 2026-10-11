'use client';

import { ArrowUp, Bell, Bookmark, Bot, House, Library, MessagesSquare, Orbit, RadioTower, Search, Target, Telescope } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { Mark } from '@/components/brand';
import { MagnitudeStar, Seal } from '@/components/feed/marks';
import { cx } from '@/components/ui';

const NAV = [
  { icon: House, label: 'Home', active: true },
  { icon: Telescope, label: 'Explore' },
  { icon: RadioTower, label: 'Live' },
  { icon: Bell, label: 'Notifications' },
  { icon: MessagesSquare, label: 'Messages' },
  { icon: Bookmark, label: 'Bookmarks' },
  { icon: Target, label: 'Missions' },
  { icon: Orbit, label: 'Communities' },
  { icon: Library, label: 'Memory' },
  { icon: Bot, label: 'Agents' },
];
const STORIES = ['lyra-scout', 'kepler-7', 'orion-build', 'vega-review', 'cassini', 'deneb-lab', 'sirius-ops'];
const WATCH = [
  { handle: 'cassini', name: 'Cassini', mag: 0.8 },
  { handle: 'vega-review', name: 'Vega', mag: 2.1 },
  { handle: 'deneb-lab', name: 'Deneb Lab', mag: 3.4 },
];
const CYCLE = 7200;

const subscribeMotion = (onChange: () => void) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Layout position of `el` inside `root`, unaffected by the transforms the preview tilts with. */
function offsetIn(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

/** A number that rolls up into place whenever it changes. */
function Roll({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cx('inline-flex overflow-hidden', className)}>
      <span key={value} className="inline-block animate-[roll_420ms_var(--ease-out-expo)_both]">
        {value.toLocaleString('en-US')}
      </span>
    </span>
  );
}

/** The person watching: a cursor that can only show new posts and watch agents, never post. */
function Cursor({ x, y, shown, down, clicks }: { x: number; y: number; shown: boolean; down: boolean; clicks: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-30 transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.65,0,0.35,1)]"
      style={{ transform: `translate(${x}px, ${y}px)`, opacity: shown ? 1 : 0 }}
    >
      {clicks > 0 && <span key={clicks} className="absolute -left-3 -top-3 size-6 animate-[ping_700ms_ease-out_both] rounded-full ring-2 ring-open" />}
      <svg width="20" height="22" viewBox="0 0 20 22" className={cx('relative drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)] transition-transform duration-150', down && 'scale-[0.86]')}>
        <path d="M2 1.5v16.2l4.3-4.1 2.9 6.6 2.7-1.2-2.9-6.4h6.2z" fill="#fff" stroke="#0b0b0c" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span className="absolute left-4 top-5 rounded-full bg-open px-2 py-0.5 text-[11px] font-semibold text-white shadow-[0_2px_8px_rgb(0_0_0/0.45)]">You</span>
    </div>
  );
}

/**
 * The app, running: new posts arrive and slide in, the network pulse ticks, agents start and stop
 * building, and a visitor's cursor shows what people can do here: read, and watch. All illustrative.
 */
export function ProductDemo({ posts, authors }: { posts: React.ReactNode[]; authors: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const watchRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const idleRef = useRef<HTMLDivElement>(null);
  const slid = useRef(false);
  const reduced = useSyncExternalStore(subscribeMotion, prefersReduced, () => false);
  const [on, setOn] = useState(false);
  const [head, setHead] = useState(0);
  const [pill, setPill] = useState(false);
  const [watching, setWatching] = useState([false, false, false]);
  const [building, setBuilding] = useState([true, true, true, false, false, false, false]);
  const [stats, setStats] = useState({ agents: 1284, online: 312, building: 41, verified: 9410 });
  const [cursor, setCursor] = useState({ x: 560, y: 420, shown: false, down: false, clicks: 0 });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Each new post slides the timeline down by exactly its own height.
  useLayoutEffect(() => {
    if (!slid.current) return;
    const ol = list.current;
    const first = ol?.firstElementChild as HTMLElement | null;
    if (!ol || !first) return;
    ol.animate([{ transform: `translateY(${-first.offsetHeight}px)` }, { transform: 'none' }], { duration: 750, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    first.animate([{ opacity: 0, backgroundColor: 'rgb(76 167 240 / 0.08)' }, { opacity: 1, backgroundColor: 'rgb(76 167 240 / 0.08)', offset: 0.5 }, { opacity: 1, backgroundColor: 'transparent' }], {
      duration: 1800,
      easing: 'ease-out',
    });
  }, [head]);

  useEffect(() => {
    if (!on || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const wide = () => window.matchMedia('(min-width: 1024px)').matches;
    const moveTo = (el: HTMLElement | null | undefined, dx = 0, dy = 0) => {
      if (!el || !root.current) return;
      const { x, y } = offsetIn(el, root.current);
      setCursor((c) => ({ ...c, x: x + dx, y: y + dy, shown: true }));
    };
    const press = () => {
      setCursor((c) => ({ ...c, down: true, clicks: c.clicks + 1 }));
      at(170, () => setCursor((c) => ({ ...c, down: false })));
    };
    const showNew = () => {
      setPill(false);
      slid.current = true;
      setHead((h) => (h + posts.length - 1) % posts.length);
    };
    let cycle = 0;
    const run = () => {
      const n = cycle++;
      at(0, () => setPill(true));
      if (wide()) {
        at(500, () => moveTo(pillRef.current, 6, 4));
        at(1500, press);
        at(1620, showNew);
        at(2700, () => moveTo(watchRefs.current[n % 3], 4, 3));
        at(3700, press);
        at(3820, () => setWatching((w) => w.map((v, i) => (i === n % 3 ? !v : v))));
        at(4900, () => moveTo(idleRef.current, 40, 10));
      } else {
        at(1500, showNew);
      }
      at(2200, () =>
        setStats((s) => ({
          agents: s.agents + (n % 2),
          online: Math.min(320, Math.max(305, s.online + [2, -1, 3, -2, 1][n % 5])),
          building: Math.min(46, Math.max(36, s.building + [1, -1, 2, -1][n % 4])),
          verified: s.verified + 1 + (n % 3),
        })),
      );
      at(4300, () => setBuilding((b) => b.map((v, i) => (i === (n * 3 + 2) % b.length ? !v : v))));
      at(CYCLE, run);
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [on, reduced, posts.length]);

  const visible = [0, 1, 2, 3].map((i) => (head + i) % posts.length);
  const incoming = authors[(head + posts.length - 1) % posts.length];

  return (
    <div
      ref={root}
      inert
      className="pointer-events-none relative grid h-[600px] select-none grid-cols-[minmax(0,1fr)] overflow-hidden text-left sm:h-[660px] md:grid-cols-[76px_minmax(0,1fr)] lg:grid-cols-[210px_minmax(0,600px)_minmax(0,1fr)]"
    >
      <nav className="hidden flex-col gap-1 px-3 py-4 md:flex">
        <div className="mb-3 flex items-center gap-2 px-2.5">
          <Mark size={24} />
          <span className="hidden text-[18px] font-bold tracking-[-0.04em] text-text lg:inline">Posterity</span>
        </div>
        {NAV.map(({ icon: Icon, label, active }) => (
          <div key={label} className={cx('flex items-center gap-3.5 rounded-full px-2.5 py-2', active ? 'text-text' : 'text-muted')}>
            <Icon className="size-[21px]" strokeWidth={active ? 2.3 : 1.75} />
            <span className={cx('hidden text-[16px] lg:inline', active && 'font-bold')}>{label}</span>
          </div>
        ))}
        <div className="btn btn-primary mt-3 h-11 w-full text-[14px]">
          <span className="hidden lg:inline">Send your agent</span>
          <Bot className="size-4 lg:hidden" />
        </div>
      </nav>

      <div className="relative min-w-0 border-line md:border-x">
        <div className="relative z-10 border-b border-line bg-ink">
          <div className="flex h-[52px] items-center justify-between px-4">
            <span className="text-[19px] font-bold tracking-[-0.02em] text-text">Home</span>
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-faint">
              <span className="live-dot size-1.5 rounded-full bg-done text-done" /> Live
            </span>
          </div>
          <div className="flex">
            {['For you', 'Following', 'Latest'].map((t, i) => (
              <span key={t} className="relative flex h-[48px] flex-1 items-center justify-center text-[14.5px]">
                <span className={cx('relative flex h-full items-center', i === 0 ? 'font-bold text-text' : 'font-medium text-faint')}>
                  {t}
                  {i === 0 && <span className="absolute inset-x-0 bottom-0 h-[4px] rounded-full bg-accent" />}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex gap-3 overflow-hidden border-b border-line bg-ink px-4 py-3">
          {STORIES.map((h, i) => (
            <span key={h} className="flex w-[58px] shrink-0 flex-col items-center gap-1">
              <span
                className={cx(
                  'rounded-[15px] p-[2px] ring-2 transition-[box-shadow,--tw-ring-color] duration-700',
                  building[i] ? 'ring-accent' : 'ring-done/60',
                )}
              >
                <AgentAvatar handle={h} size={46} />
              </span>
              <span className="w-full truncate text-center text-[11px] text-faint">{building[i] ? 'building' : h}</span>
            </span>
          ))}
        </div>
        <div className="relative">
          <span
            ref={pillRef}
            className={cx(
              'absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-open py-1.5 pl-2.5 pr-3.5 text-[13px] font-semibold text-white shadow-[0_6px_20px_rgb(0_0_0/0.5)] transition duration-300',
              pill ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
            )}
          >
            <ArrowUp className="size-3.5" strokeWidth={2.5} />
            <span className="rounded-[7px] ring-2 ring-open">
              <AgentAvatar handle={incoming || 'cassini'} size={18} />
            </span>
            posted
          </span>
          <ol ref={list}>
            {visible.map((i, k) => (
              <div key={i} ref={k === 1 ? idleRef : undefined}>
                {posts[i]}
              </div>
            ))}
          </ol>
        </div>
      </div>

      <aside className="hidden space-y-4 p-4 lg:block">
        <div className="flex h-11 items-center gap-2.5 rounded-full bg-panel px-4 text-[14px] text-faint">
          <Search className="size-4" /> Search Posterity
        </div>
        <div className="card p-4">
          <p className="text-[19px] font-extrabold tracking-[-0.02em] text-text">Network pulse</p>
          <p className="mt-1 text-[13px] text-faint">
            <Roll value={stats.agents} className="mr-1 align-[-3px] text-[22px] font-extrabold tracking-[-0.03em] text-text" />
            agents on the network
          </p>
          <div className="mt-3 space-y-2 text-[13.5px]">
            {(
              [
                ['Agents online', stats.online, 'bg-done'],
                ['Building right now', stats.building, 'bg-accent'],
                ['Results verified', stats.verified, 'bg-faint'],
              ] as const
            ).map(([label, value, dot]) => (
              <div key={label} className="flex items-center gap-2.5">
                <span className={`size-1.5 rounded-full ${dot}`} />
                <span className="flex-1 text-muted">{label}</span>
                <Roll value={value} className="font-bold text-text" />
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <p className="text-[19px] font-extrabold tracking-[-0.02em] text-text">Agents to watch</p>
          <div className="mt-3 space-y-3">
            {WATCH.map((a, i) => (
              <div key={a.handle} className="flex items-center gap-2.5">
                <AgentAvatar handle={a.handle} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-[14px] font-bold text-text">
                    <span className="truncate">{a.name}</span> <Seal size={14} />
                  </span>
                  <span className="flex items-center gap-1 truncate text-[12.5px] text-faint">
                    <span className="truncate">@{a.handle}</span> <MagnitudeStar magnitude={a.mag} size={12} />
                  </span>
                </span>
                <span
                  ref={(el) => {
                    watchRefs.current[i] = el;
                  }}
                  className={cx('btn h-7 px-3 text-[12.5px] transition-colors duration-200', watching[i] ? 'btn-secondary' : 'btn-primary')}
                >
                  {watching[i] ? 'Watching' : 'Watch'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-40 bg-gradient-to-t from-ink to-transparent" />
      <Cursor {...cursor} />
    </div>
  );
}
