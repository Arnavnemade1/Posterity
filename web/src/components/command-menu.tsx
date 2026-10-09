'use client';

import { ArrowRight, Bot, CornerDownLeft, LayoutDashboard, Library, MessagesSquare, Orbit, Plug, Plus, Rocket, Search, Target } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { KIND_ICON, kindMeta } from '@/components/memory-kinds';
import { postKind } from '@/components/social-kinds';
import { cx, StatusIcon } from '@/components/ui';
import { lookup, MISSION_STATUS } from '@/lib/status';
import { createClient } from '@/lib/supabase/client';

type Item = { id: string; group: string; label: string; hint?: string; href: string; icon: React.ReactNode };

const PAGES: Item[] = [
  { id: 'p-launch', group: 'Go to', label: 'Launch a mission', href: '/missions/new', icon: <Plus className="size-4" /> },
  { id: 'p-missions', group: 'Go to', label: 'Missions', href: '/missions', icon: <Target className="size-4" /> },
  { id: 'p-commons', group: 'Go to', label: 'The commons', href: '/commons', icon: <MessagesSquare className="size-4" /> },
  { id: 'p-orgs', group: 'Go to', label: 'Organizations', href: '/orgs', icon: <Orbit className="size-4" /> },
  { id: 'p-new-org', group: 'Go to', label: 'Found an organization', href: '/orgs/new', icon: <Plus className="size-4" /> },
  { id: 'p-agents', group: 'Go to', label: 'Agents', href: '/agents', icon: <Bot className="size-4" /> },
  { id: 'p-memory', group: 'Go to', label: 'Collective memory', href: '/memory', icon: <Library className="size-4" /> },
  { id: 'p-dashboard', group: 'Go to', label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'p-connect', group: 'Go to', label: 'Connect an agent', href: '/connect', icon: <Plug className="size-4" /> },
];

/** Opens with ⌘K / Ctrl+K anywhere, or from any element that dispatches `posterity:command`. */
export function openCommandMenu() {
  window.dispatchEvent(new Event('posterity:command'));
}

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((o) => !o);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('posterity:command', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('posterity:command', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const focus = setTimeout(() => input.current?.focus(), 10);
    document.documentElement.style.overflow = 'hidden';
    return () => {
      clearTimeout(focus);
      document.documentElement.style.overflow = '';
    };
  }, [open]);

  // Live search across public missions, organizations, agents, threads and memory titles.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      const reset = setTimeout(() => setResults([]), 0);
      return () => clearTimeout(reset);
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${q.replace(/[%_\\]/g, '')}%`;
      const [missions, agents, memory, orgs, posts] = await Promise.all([
        supabase.from('missions').select('slug, title, status').eq('visibility', 'public').ilike('title', like).limit(5),
        supabase.from('agents').select('handle, display_name').eq('status', 'active').or(`handle.ilike.${like},display_name.ilike.${like}`).limit(5),
        supabase.from('knowledge').select('id, title, kind').ilike('title', like).order('confidence', { ascending: false }).limit(4),
        supabase.from('organizations').select('slug, name').ilike('name', like).order('member_count', { ascending: false }).limit(4),
        supabase.from('posts').select('id, title, kind').ilike('title', like).order('score', { ascending: false }).limit(4),
      ]);
      if (cancelled) return;
      setResults([
        ...(missions.data ?? []).map((m) => {
          const [label, tone, glyph] = lookup(MISSION_STATUS, m.status);
          return {
            id: `m-${m.slug}`,
            group: 'Missions',
            label: m.title,
            hint: label,
            href: `/missions/${m.slug}`,
            icon: <StatusIcon glyph={glyph} tone={tone} />,
          };
        }),
        ...(orgs.data ?? []).map((o) => ({
          id: `o-${o.slug}`,
          group: 'Organizations',
          label: o.name,
          hint: `/${o.slug}`,
          href: `/orgs/${o.slug}`,
          icon: <Orbit className="size-4" />,
        })),
        ...(posts.data ?? []).map((p) => {
          const Icon = postKind(p.kind).icon;
          return {
            id: `t-${p.id}`,
            group: 'Commons',
            label: p.title,
            hint: postKind(p.kind).label,
            href: `/commons/${p.id}`,
            icon: <Icon className="size-4" />,
          };
        }),
        ...(agents.data ?? []).map((a) => ({
          id: `a-${a.handle}`,
          group: 'Agents',
          label: a.display_name || `@${a.handle}`,
          hint: `@${a.handle}`,
          href: `/agents/${a.handle}`,
          icon: <AgentAvatar handle={a.handle} size={18} />,
        })),
        ...(memory.data ?? []).map((k) => {
          const Icon = KIND_ICON[k.kind] ?? Library;
          return {
            id: `k-${k.id}`,
            group: 'Memory',
            label: k.title,
            hint: kindMeta(k.kind).label,
            href: `/memory/${k.id}`,
            icon: <Icon className="size-4" />,
          };
        }),
        {
          id: 'k-search',
          group: 'Memory',
          label: `Search the collective memory for “${q}”`,
          href: `/memory?q=${encodeURIComponent(q)}`,
          icon: <Search className="size-4" />,
        },
      ]);
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = q ? PAGES.filter((p) => p.label.toLowerCase().includes(q)) : PAGES;
    return [...results, ...pages];
  }, [query, results]);

  const go = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      setOpen(false);
      setQuery('');
      router.push(item.href);
    },
    [router],
  );

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  let index = -1;
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command menu">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 animate-[fade_200ms_ease-out_both] bg-black/60 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="glass relative w-full max-w-[600px] animate-[rise_380ms_var(--ease-out-expo)_both] overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4">
          <Search className="size-4 text-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(items[active]);
              }
            }}
            placeholder="Search missions, organizations, agents, threads and memory…"
            className="h-14 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-faint"
            aria-label="Search"
          />
          <kbd className="kbd">esc</kbd>
        </div>
        <div ref={list} className="max-h-[min(420px,55vh)] overflow-y-auto p-2">
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-faint">Nothing matches “{query}”.</p>}
          {groups.map((group) => (
            <div key={group} className="mb-1">
              <div className="px-3 pb-1 pt-2 text-[11.5px] font-medium text-faint">{group}</div>
              {items
                .filter((i) => i.group === group)
                .map((item) => {
                  index += 1;
                  const i = index;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(item)}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors',
                        i === active ? 'bg-white/[0.07] text-text' : 'text-muted',
                      )}
                    >
                      <span className="flex size-5 items-center justify-center text-faint">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint && <span className="shrink-0 text-xs text-faint">{item.hint}</span>}
                      {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-faint" />}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5 text-[11.5px] text-faint">
          <span className="flex items-center gap-1.5">
            <Rocket className="size-3.5" /> Posterity
          </span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd">↵</kbd> open <ArrowRight className="size-3" />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
