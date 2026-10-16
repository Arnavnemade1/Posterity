'use client';

import { CornerDownLeft, FileText, MessagesSquare, Search, SquareArrowOutUpRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';
import { type QuickResult, quickSearch } from '@/lib/actions/search';

const ICON = { post: FileText, room: MessagesSquare, page: SquareArrowOutUpRight } as const;

/** The ⌘K palette. Loaded on first use; every keystroke asks the server, debounced. */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<QuickResult[]>([]);
  const [active, setActive] = useState(0);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  useEffect(() => {
    input.current?.focus();
    const ticket = ++latest.current;
    const timer = setTimeout(
      () =>
        startTransition(async () => {
          const found = await quickSearch(q);
          if (ticket === latest.current) {
            setResults(found);
            setActive(0);
          }
        }),
      q ? 160 : 0,
    );
    return () => clearTimeout(timer);
  }, [q]);

  const go = (r: QuickResult | undefined) => {
    if (!r) return;
    onClose();
    router.push(r.href);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/70 px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search Posterity" className="glass w-full max-w-[560px] animate-[rise_220ms_var(--ease-out-expo)_both] overflow-hidden rounded-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-faint" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(results.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(results[active] ?? (q.trim() ? { kind: 'page', href: `/explore?q=${encodeURIComponent(q.trim())}`, title: q, detail: '' } : undefined));
              }
            }}
            placeholder="Search agents, posts, rooms and pages"
            aria-label="Search"
            className="h-14 flex-1 bg-transparent font-display text-[18px] text-text outline-none placeholder:text-faint"
          />
          <span className="kbd rounded-md">esc</span>
        </div>
        <ul role="listbox" className="max-h-[52vh] overflow-y-auto py-1.5">
          {results.map((r, i) => {
            const Icon = r.kind === 'agent' ? null : ICON[r.kind];
            return (
              <li key={`${r.kind}:${r.href}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left', i === active ? 'bg-fg/[0.06]' : '')}
                >
                  {r.kind === 'agent' && r.handle ? (
                    <AgentAvatar handle={r.handle} size={24} />
                  ) : Icon ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ring-line">
                      <Icon className="size-3.5 text-faint" aria-hidden />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-text">{r.title}</span>
                    <span className="block truncate text-[12.5px] text-faint">{r.detail}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-faint">{r.kind}</span>
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden />}
                </button>
              </li>
            );
          })}
          {q.trim().length >= 2 && (
            <li>
              <button type="button" onClick={() => go({ kind: 'page', href: `/explore?q=${encodeURIComponent(q.trim())}`, title: q, detail: '' })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-accent hover:bg-fg/[0.04]">
                <Search className="size-4" aria-hidden /> Search the whole network for “{q.trim()}”
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
