'use client';

import { RefreshCw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  panel: ReactNode;
}

/** One directory for every runtime; selection keeps each agent's form drafts mounted. */
export function AgentFleet({ entries }: { entries: FleetEntry[] }) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [runtime, setRuntime] = useState('all');
  const [selected, setSelected] = useState<string | null>(null);
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
  const active = visible.find((e) => e.id === selected)?.id ?? visible[0]?.id;
  const attention = entries.filter((e) => e.attention.length).length;

  return (
    <section className="space-y-4" aria-label="Agent fleet">
      <div className="overflow-hidden rounded-2xl bg-panel ring-1 ring-inset ring-line">
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="text-[16px] font-bold text-text">Your agents</h2>
            <p className="mt-1 text-[13px] text-faint">{entries.length} agent identities · {attention} need attention</p>
          </div>
          <button className={buttonClass('secondary', 'sm')} disabled={refreshing} onClick={() => refresh(() => router.refresh())} aria-label="Refresh agent status">
            <RefreshCw className={cx('size-3.5', refreshing && 'animate-spin')} aria-hidden /> Refresh
          </button>
        </header>
        <div className="flex flex-wrap gap-2 p-4">
          <label className="relative min-w-44 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-faint" aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="field h-10 pl-9" placeholder="Find a name, model, skill or tool" aria-label="Search agents" />
          </label>
          <select value={runtime} onChange={(e) => setRuntime(e.target.value)} className="field h-10 w-auto max-w-full" aria-label="Filter by runtime">
            <option value="all">All runtimes</option>
            {runtimes.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="field h-10 w-auto" aria-label="Filter by status">
            <option value="all">All statuses</option>
            <option value="attention">Needs attention ({attention})</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="paused">Paused</option>
            <option value="disconnected">No active key</option>
          </select>
        </div>
        <p className="sr-only" role="status">{visible.length} of {entries.length} agents shown</p>
        <ul className="max-h-96 overflow-y-auto divide-y divide-line border-t border-line">
          {visible.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setSelected(e.id)} aria-pressed={active === e.id} aria-controls={`fleet-${e.id}`}
                className={cx('flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-fg/[0.04]', active === e.id && 'bg-fg/[0.04] ring-1 ring-inset ring-open/30')}>
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
                  <span className="mt-1 block text-faint">{e.work === null ? 'Work unavailable' : `${e.work} active ${e.work === 1 ? 'task' : 'tasks'}`}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!visible.length && <div className="px-5 py-8 text-center text-[14px] text-faint">No agents match these filters. <button className="text-open hover:underline" onClick={() => { setQuery(''); setFilter('all'); setRuntime('all'); }}>Clear filters</button></div>}
      </div>
      {entries.map((e) => <div key={e.id} id={`fleet-${e.id}`} hidden={active !== e.id}>{e.panel}</div>)}
    </section>
  );
}
