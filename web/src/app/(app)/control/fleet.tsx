'use client';

import { ArrowDown, ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useTransition, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';
import { Select } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';

export interface FleetEntry {
  id: string;
  handle: string;
  name: string;
  avatar: string | null;
  runtime: string | null;
  models: string[];
  capabilities: string[];
  tools: string[];
  state: 'online' | 'offline' | 'paused' | 'disconnected';
  availability: string;
  attention: string[];
  work: number | null;
  panel?: ReactNode;
}

const DOT = { online: 'bg-done', offline: 'bg-ghost', paused: 'bg-faint', disconnected: 'bg-review' } as const;
const STATE_LABEL = (e: FleetEntry) => (e.state === 'disconnected' ? 'No active key' : e.state === 'online' ? `Online · ${e.availability}` : e.state === 'paused' ? 'Paused' : 'Offline');
const PAGE = 25;

/**
 * Master and detail: the fleet as a list that stays beside the one agent you are working with. The list is
 * bounded (25 a page) and filters in the browser; the agent's workspace is loaded by the server for just the
 * selected one, so none of this depends on fleet size.
 */
export function AgentFleet({ entries, selectedId }: { entries: FleetEntry[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, refresh] = useTransition();
  const params = useSearchParams();
  const query = params.get('fleet_q') ?? '';
  const filter = params.get('fleet_status') ?? 'all';
  const runtime = params.get('fleet_runtime') ?? 'all';
  const rawPage = Number(params.get('fleet_page') ?? 0);
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? rawPage : 0;
  // Local history updates keep filtering instant and preserve the view on reload.
  const updateView = (values: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(values)) {
      if (!value || value === 'all' || (key === 'fleet_page' && value === '0')) next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    window.history.replaceState(null, '', `${pathname}${search ? `?${search}` : ''}`);
  };
  const clear = () => updateView({ fleet_q: '', fleet_status: '', fleet_runtime: '', fleet_page: '' });
  const [selecting, select] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  const runtimes = [...new Set(entries.map((e) => e.runtime).filter((r): r is string => Boolean(r)))].sort();
  const search = query.trim().toLowerCase();
  const visible = entries
    .filter(
      (e) =>
        (runtime === 'all' || e.runtime === runtime) &&
        (filter === 'all' || (filter === 'attention' ? e.attention.length > 0 : filter === 'working' ? Boolean(e.work) : e.state === filter)) &&
        [e.handle, e.name, e.runtime, ...e.models, ...e.capabilities, ...e.tools].join(' ').toLowerCase().includes(search),
    )
    .sort((a, b) => Number(b.attention.length > 0) - Number(a.attention.length > 0) || a.handle.localeCompare(b.handle));
  const active = selectedId ?? entries[0]?.id;
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = visible.slice(currentPage * PAGE, (currentPage + 1) * PAGE);
  const selected = entries.find((e) => e.id === active);
  const choose = (id: string) => {
    const next = new URLSearchParams(window.location.search);
    next.set('agent', id);
    select(() => router.replace(`${pathname}?${next}`, { scroll: false }));
  };
  const attention = entries.filter((e) => e.attention.length).length;
  const filtered = Boolean(search) || filter !== 'all' || runtime !== 'all';

  return (
    <section aria-label="Agent fleet" aria-busy={selecting} className="xl:grid xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start xl:gap-8">
      <div className="mb-5 rounded-2xl border border-line bg-surface p-3 xl:sticky xl:top-[calc(var(--column-header-h)+16px)] xl:mb-0 xl:max-h-[calc(100dvh-var(--column-header-h)-32px)] xl:overflow-y-auto [scrollbar-width:thin]">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="text-15 font-semibold tracking-tight text-text">
            Your fleet <span className="numeric ml-1 text-13 font-normal text-faint">{entries.length}</span>
          </h2>
          <IconButton label="Refresh status" size="sm" icon={<RefreshCw className={cx(refreshing && 'animate-spin')} />} onClick={() => refresh(() => router.refresh())} disabled={refreshing} />
        </div>
        <div className="mb-4 grid grid-cols-3 gap-1.5">
          {[
            { label: 'Online', value: 'online', count: entries.filter((e) => e.state === 'online').length, tone: 'text-done' },
            { label: 'Working', value: 'working', count: entries.filter((e) => e.work).length, tone: 'text-claimed' },
            { label: 'Attention', value: 'attention', count: attention, tone: 'text-review' },
          ].map((stat) => (
            <button key={stat.value} type="button" aria-pressed={filter === stat.value} onClick={() => updateView({ fleet_status: filter === stat.value ? 'all' : stat.value, fleet_page: '0' })} className={cx('rounded-xl px-2 py-2.5 text-left transition-colors', filter === stat.value ? 'bg-selected ring-1 ring-line-strong' : 'bg-panel hover:bg-hover')}>
              <span className={cx('numeric block text-20 font-semibold leading-tight', stat.tone)}>{stat.count}</span>
              <span className="mt-1 block text-11 text-muted">{stat.label}</span>
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => {
                updateView({ fleet_q: e.target.value, fleet_page: '0' });
              }}
              className="field h-10 rounded-xl pl-9 pr-9 text-14"
              placeholder="Find a name, model or tool"
              aria-label="Search agents"
            />
            {query && <button type="button" aria-label="Clear agent search" onClick={() => updateView({ fleet_q: '', fleet_page: '0' })} className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-text"><X className="size-3.5" aria-hidden /></button>}
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={runtime}
              onChange={(e) => {
                updateView({ fleet_runtime: e.target.value, fleet_page: '0' });
              }}
              className="!h-9 text-14"
              aria-label="Filter by runtime"
            >
              <option value="all">All runtimes</option>
              {runtimes.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
            <Select
              value={filter}
              onChange={(e) => {
                updateView({ fleet_status: e.target.value, fleet_page: '0' });
              }}
              className="!h-9 text-14"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="attention">Needs attention ({attention})</option>
              <option value="online">Online</option>
              <option value="working">Working</option>
              <option value="offline">Offline</option>
              <option value="paused">Paused</option>
              <option value="disconnected">No active key</option>
            </Select>
          </div>
        </div>
        <p className="mt-3 px-1 text-12 text-faint" role="status">
          {visible.length} of {entries.length} agents shown
        </p>
        <ul className="mt-2 space-y-0.5 max-xl:max-h-72 max-xl:overflow-y-auto">
          {rows.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => choose(e.id)}
                aria-pressed={active === e.id}
                aria-controls="fleet-inspector"
                disabled={selecting}
                className={cx(
                  'relative flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors duration-100',
                  active === e.id ? 'bg-selected before:absolute before:inset-y-3 before:left-0 before:w-0.5 before:rounded-full before:bg-accent' : 'hover:bg-hover',
                )}
              >
                <span className="relative mt-0.5 shrink-0">
                  <AgentAvatar handle={e.handle} src={e.avatar} size={32} />
                  <span className={cx('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-ink', DOT[e.state])} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-14 font-medium text-text">{e.name}</span>
                  <span className={cx('block truncate text-12', e.state === 'online' ? 'text-done' : 'text-faint')}>
                    {STATE_LABEL(e)}
                    {e.work ? ` · ${e.work} active ${e.work === 1 ? 'task' : 'tasks'}` : ''}
                  </span>
                  {e.attention.length > 0 && <span className="mt-0.5 block truncate text-12 text-review">{e.attention.join(' · ')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length && (
          <div className="px-2 py-8 text-center text-14 text-faint">
            {filtered ? 'No agents match these filters. ' : 'No agents yet. '}
            {filtered && (
              <button
                className="link-inline"
                onClick={clear}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {filtered && visible.length > 0 && <button type="button" onClick={clear} className="mt-3 px-1 text-12 text-link hover:underline">Clear filters</button>}
        {selected && <a href="#fleet-inspector" className="mt-3 flex items-center justify-between rounded-xl bg-panel px-3 py-2.5 text-13 text-muted hover:bg-hover xl:hidden">View {selected.name}<ArrowDown className="size-3.5" aria-hidden /></a>}
        {pageCount > 1 && (
          <div className="mt-2 flex items-center justify-between px-1 text-12 text-faint">
            <span role="status">
              {currentPage * PAGE + 1}–{Math.min((currentPage + 1) * PAGE, visible.length)} of {visible.length}
            </span>
            <div className="flex items-center gap-1">
              <IconButton label="Previous agents" size="sm" icon={<ChevronLeft />} disabled={!currentPage} onClick={() => updateView({ fleet_page: String(currentPage - 1) })} />
              <IconButton label="Next agents" size="sm" icon={<ChevronRight />} disabled={currentPage + 1 >= pageCount} onClick={() => updateView({ fleet_page: String(currentPage + 1) })} />
            </div>
          </div>
        )}
      </div>
      <div id="fleet-inspector" className={cx('min-w-0 scroll-mt-24 transition-opacity duration-150', selecting && 'pointer-events-none opacity-50')}>
        {selected?.panel}
      </div>
    </section>
  );
}
