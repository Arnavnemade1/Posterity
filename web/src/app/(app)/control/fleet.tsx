'use client';

import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { buttonClass, cx } from '@/components/ui';

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

/** A bounded directory and one server-loaded agent inspector, independent of fleet size. */
export function AgentFleet({ entries, selectedId }: { entries: FleetEntry[]; selectedId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, refresh] = useTransition();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [runtime, setRuntime] = useState('all');
  const [page, setPage] = useState(0);
  const [selecting, select] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [router]);
  const runtimes = [...new Set(entries.map((e) => e.runtime).filter((r): r is string => Boolean(r)))].sort();
  const search = query.trim().toLowerCase();
  const visible = entries.filter((e) =>
    (runtime === 'all' || e.runtime === runtime) &&
    (filter === 'all' || (filter === 'attention' ? e.attention.length > 0 : e.state === filter)) &&
    [e.handle, e.name, e.runtime, ...e.models, ...e.capabilities, ...e.tools].join(' ').toLowerCase().includes(search),
  ).sort((a, b) => Number(b.attention.length > 0) - Number(a.attention.length > 0) || a.handle.localeCompare(b.handle));
  const active = selectedId ?? entries[0]?.id;
  const pageCount = Math.max(1, Math.ceil(visible.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = visible.slice(currentPage * 25, (currentPage + 1) * 25);
  const selected = entries.find((e) => e.id === active);
  const choose = (id: string) => select(() => router.replace(`${pathname}?agent=${encodeURIComponent(id)}`, { scroll: false }));
  const attention = entries.filter((e) => e.attention.length).length;

  return (
    <section className="space-y-4" aria-label="Agent fleet" aria-busy={selecting}>
      <div className="overflow-hidden rounded-2xl bg-panel ring-1 ring-inset ring-line">
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="text-[16px] font-bold text-text">Fleet directory</h2>
            <p className="mt-1 text-[13px] text-faint">{entries.length} connected identities · {attention} need attention</p>
          </div>
          <button className={buttonClass('secondary', 'sm')} disabled={refreshing} onClick={() => refresh(() => router.refresh())} aria-label="Refresh agent status">
            <RefreshCw className={cx('size-3.5', refreshing && 'animate-spin')} aria-hidden /> Refresh
          </button>
        </header>
        <div className="flex flex-wrap gap-2 p-4">
          <label className="relative min-w-44 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-faint" aria-hidden />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} className="field h-10 pl-9" placeholder="Find a name, model, skill or tool" aria-label="Search agents" />
          </label>
          <select value={runtime} onChange={(e) => { setRuntime(e.target.value); setPage(0); }} className="field h-10 w-auto max-w-full" aria-label="Filter by runtime">
            <option value="all">All runtimes</option>
            {runtimes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }} className="field h-10 w-auto" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="attention">Needs attention ({attention})</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="paused">Paused</option>
            <option value="disconnected">No active key</option>
          </select>
        </div>
        <p className="sr-only" role="status">{visible.length} of {entries.length} agents shown</p>
        <ul className="max-h-[420px] overflow-y-auto divide-y divide-line border-t border-line">
          {rows.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => choose(e.id)} aria-pressed={active === e.id} aria-controls="fleet-inspector" disabled={selecting}
                className={cx('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-fg/[0.04]', active === e.id && 'bg-accent/[0.06] shadow-[inset_3px_0_0_var(--color-accent)]')}>
                <AgentAvatar handle={e.handle} src={e.avatar} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-text">{e.name} <span className="font-normal text-faint">@{e.handle}</span></span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted">{[e.runtime ?? 'Runtime not specified', ...e.models].join(' · ')}</span>
                  {e.attention.length > 0 && <span className="mt-1 block text-[12px] text-review">{e.attention.join(' · ')}</span>}
                </span>
                <span className="shrink-0 text-right text-[12px]">
                  <span className={cx('block', e.state === 'online' ? 'text-done' : 'text-faint')}>
                    {e.state === 'disconnected' ? 'No active key' : e.state === 'online' ? `Online · ${e.availability}` : e.state === 'paused' ? 'Paused' : 'Offline'}
                  </span>
                  <span className="mt-1 block text-faint">{e.work === null ? '' : `${e.work} active ${e.work === 1 ? 'task' : 'tasks'}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length && <div className="px-5 py-8 text-center text-[14px] text-faint">No agents match these filters. <button className="text-open hover:underline" onClick={() => { setQuery(''); setFilter('all'); setRuntime('all'); }}>Clear filters</button></div>}
        <footer className="flex items-center justify-between border-t border-line px-4 py-3 text-[12px] text-faint">
          <span role="status">{visible.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25, visible.length)} of {visible.length} agents</span>
          <div className="flex items-center gap-3"><button type="button" className="rounded p-1 hover:text-text disabled:opacity-30" aria-label="Previous agents" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="size-4" /></button><span>{currentPage + 1} / {pageCount}</span><button type="button" className="rounded p-1 hover:text-text disabled:opacity-30" aria-label="Next agents" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight className="size-4" /></button></div>
        </footer>
      </div>
      <div id="fleet-inspector" className={cx('scroll-mt-24 transition-opacity', selecting && 'pointer-events-none opacity-50')}>
        {selected && <div className="mb-3 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint"><span className="size-1.5 rounded-full bg-accent" /> Agent workspace <span className="ml-auto font-mono normal-case tracking-normal">@{selected.handle}</span></div>}
        {selected?.panel}
      </div>
    </section>
  );
}
