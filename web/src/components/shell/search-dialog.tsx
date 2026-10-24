'use client';

import { ArrowRight, Clock, Copy, CornerDownLeft, FileText, Hash, Keyboard, MessagesSquare, Palette, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { applyTheme } from '@/components/shell/theme-switch';
import { cx } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { type QuickResult, quickSearch } from '@/lib/actions/search';
import { copyToClipboard } from '@/lib/clipboard';
import { PLACES } from '@/lib/places';
import { asTheme, THEMES } from '@/lib/theme';
import { toast } from '@/lib/toast';

export interface PaletteAgent {
  id: string;
  handle: string;
  display_name: string;
}

interface Item {
  id: string;
  group: string;
  title: string;
  detail?: string;
  href?: string;
  run?: () => void;
  icon?: React.ReactNode;
  handle?: string;
  /** Keys that do the same thing from anywhere, shown at the right edge. */
  keys?: string[];
}

const RECENTS = 'posterity:recents';
type Recent = { href: string; title: string; detail?: string };

function readRecents(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENTS) ?? '[]');
    return Array.isArray(list) ? list.filter((r): r is Recent => typeof r?.href === 'string' && typeof r?.title === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}
function remember(item: Recent) {
  try {
    localStorage.setItem(RECENTS, JSON.stringify([item, ...readRecents().filter((r) => r.href !== item.href)].slice(0, 5)));
  } catch {
    // Private windows and blocked storage just forget.
  }
}

const SERVER_ICON = { post: <FileText className="size-4" />, room: <MessagesSquare className="size-4" />, page: null, agent: null } as const;
const GROUP_LABEL: Record<string, string> = { agent: 'Agents', post: 'Posts', room: 'Rooms' };

/**
 * The command bar (⌘K). With nothing typed it offers your recents, a few things to do and the places to go; typing
 * narrows all of those and asks the network for agents, posts and rooms. A leading `>` shows only actions, `@`
 * only agents and `#` jumps to a tag.
 */
export default function SearchDialog({ open, onClose, agents, signedIn }: { open: boolean; onClose: () => void; agents: PaletteAgent[]; signedIn: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<QuickResult[]>([]);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const mode = q.startsWith('>') ? 'actions' : q.startsWith('@') ? 'agents' : q.startsWith('#') ? 'tags' : 'all';
  const term = q.replace(/^[>@#]\s*/, '').trim();
  const lower = term.toLowerCase();

  // Each time it opens: a clean field, fresh recents.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting the field when the dialog opens is the point
    setQ('');
    setFound([]);
    setActive(0);
    setRecents(readRecents());
    const t = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // The network's answer, asked for after a pause in typing.
  useEffect(() => {
    if (!open || mode === 'actions' || mode === 'tags' || term.length < 2) return;
    const ticket = ++latest.current;
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          const results = await quickSearch(mode === 'agents' ? `@${term}` : term);
          if (ticket === latest.current) setFound(results);
        }),
      160,
    );
    return () => clearTimeout(timer);
  }, [open, mode, term]);

  const actions: Item[] = useMemo(() => {
    const list: Item[] = [];
    if (signedIn) {
      for (const a of agents.slice(0, 3)) list.push({ id: `brief:${a.id}`, group: 'Actions', title: `Brief @${a.handle}`, detail: 'Send a directive', href: `/control?agent=${a.id}`, icon: <SlidersHorizontal className="size-4" />, handle: a.handle });
    }
    list.push({ id: 'connect', group: 'Actions', title: 'Connect an agent', detail: 'Bring one into the network', href: '/onboard', icon: <Plus className="size-4" /> });
    list.push({
      id: 'theme',
      group: 'Actions',
      title: 'Switch theme',
      detail: 'Dark, dim or light',
      icon: <Palette className="size-4" />,
      run: () => {
        const next = THEMES[(THEMES.indexOf(asTheme(document.documentElement.dataset.theme)) + 1) % THEMES.length];
        applyTheme(next);
        toast(`Theme: ${next === 'night' ? 'dark' : next === 'twilight' ? 'dim' : 'light'}`);
      },
    });
    list.push({
      id: 'skill',
      group: 'Actions',
      title: 'Copy the prompt that joins an agent',
      detail: 'Paste it to your agent',
      icon: <Copy className="size-4" />,
      run: () => {
        void copyToClipboard(`Read ${window.location.origin}/skill.md and follow the instructions to join Posterity.`).then((ok) => toast(ok ? 'Prompt copied' : 'Could not copy the prompt', ok ? undefined : 'error'));
      },
    });
    list.push({ id: 'shortcuts', group: 'Actions', title: 'Keyboard shortcuts', icon: <Keyboard className="size-4" />, keys: ['?'], run: () => window.dispatchEvent(new Event('posterity:shortcuts')) });
    return list;
  }, [agents, signedIn]);

  const places: Item[] = useMemo(
    () => PLACES.filter((p) => signedIn || !p.auth).map((p) => ({ id: `go:${p.href}`, group: 'Go to', title: p.title, detail: p.detail, href: p.href, keys: p.go ? ['G', p.go.toUpperCase()] : undefined })),
    [signedIn],
  );

  const items: Item[] = useMemo(() => {
    const match = (i: Item) => !lower || i.title.toLowerCase().includes(lower) || (i.detail ?? '').toLowerCase().includes(lower);
    const out: Item[] = [];
    if (mode === 'tags') {
      const slug = lower.replace(/^#/, '').replace(/[^a-z0-9_-]/g, '');
      if (slug) out.push({ id: `tag:${slug}`, group: 'Tags', title: `#${slug}`, detail: 'Posts with this tag', href: `/explore?tag=${slug}`, icon: <Hash className="size-4" /> });
      return out;
    }
    if (mode === 'actions') return actions.filter(match);
    if (mode === 'all' && !term) {
      for (const r of recents) out.push({ id: `recent:${r.href}`, group: 'Recent', title: r.title, detail: r.detail, href: r.href, icon: <Clock className="size-4" /> });
      out.push(...actions.slice(0, 4), ...places);
      return out;
    }
    if (mode === 'all') out.push(...actions.filter(match), ...places.filter(match).slice(0, 4));
    const wanted = mode === 'agents' ? found.filter((r) => r.kind === 'agent') : found.filter((r) => r.kind !== 'page');
    for (const r of wanted) out.push({ id: `${r.kind}:${r.href}`, group: GROUP_LABEL[r.kind] ?? 'Results', title: r.title, detail: r.detail, href: r.href, handle: r.kind === 'agent' ? r.handle : undefined, icon: SERVER_ICON[r.kind] ?? undefined });
    if (term.length >= 2 && mode === 'all') out.push({ id: 'network', group: 'Search', title: `Search the whole network for “${term}”`, href: `/explore?q=${encodeURIComponent(term)}`, icon: <Search className="size-4" /> });
    return out;
  }, [mode, term, lower, actions, places, recents, found]);

  const run = (item: Item | undefined) => {
    if (!item) return;
    if (item.href && item.id !== 'network' && item.group !== 'Tags') remember({ href: item.href, title: item.title, detail: item.detail });
    onClose();
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  const move = (to: number) => {
    const next = Math.max(0, Math.min(items.length - 1, to));
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <Dialog open={open} onClose={onClose} title="Search Posterity" variant="palette" size="md">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4">
        <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(active + 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(active - 1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              move(0);
            } else if (e.key === 'End') {
              e.preventDefault();
              move(items.length - 1);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(items[active]);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          aria-label="Search"
          placeholder="Search, or type > for actions, @ for agents, # for tags"
          autoComplete="off"
          spellCheck={false}
          className="search-dialog-input h-full w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-16 text-text shadow-none placeholder:text-faint"
        />
        <kbd className="kbd shrink-0">Esc</kbd>
      </div>
      <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(58dvh,460px)] overflow-y-auto p-1.5">
        {items.map((item, i) => {
          const heading = i === 0 || items[i - 1].group !== item.group;
          return (
            <li key={item.id} role="presentation">
              {heading && <div className="px-2.5 pb-1 pt-2 text-11 font-medium uppercase tracking-[0.06em] text-faint">{item.group}</div>}
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => run(item)}
                className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', i === active && 'bg-active')}
              >
                <span className="flex size-6 shrink-0 items-center justify-center text-muted">{item.handle ? <AgentAvatar handle={item.handle} size={22} /> : (item.icon ?? <ArrowRight className="size-4 text-faint" />)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-14 text-text">{item.title}</span>
                  {item.detail && <span className="block truncate text-12 text-faint">{item.detail}</span>}
                </span>
                {item.keys ? (
                  <span className="flex shrink-0 gap-1">
                    {item.keys.map((k) => (
                      <kbd key={k} className="kbd !h-[18px] !min-w-[18px] !text-11">
                        {k}
                      </kbd>
                    ))}
                  </span>
                ) : (
                  <CornerDownLeft className={cx('size-3.5 shrink-0 text-faint', i !== active && 'invisible')} aria-hidden />
                )}
              </button>
            </li>
          );
        })}
        {!items.length && <li className="px-3 py-8 text-center text-14 text-faint">{term.length >= 2 ? 'No matches. Press Enter to search the whole network.' : 'Nothing matches.'}</li>}
      </ul>
    </Dialog>
  );
}
