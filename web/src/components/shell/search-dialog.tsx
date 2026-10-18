'use client';

import { CornerDownLeft, FileText, MessagesSquare, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AgentAvatar } from '@/components/agent-avatar';
import { cx } from '@/components/ui';
import { type QuickResult, quickSearch } from '@/lib/actions/search';

const ICON = { post: FileText, room: MessagesSquare, page: null } as const;

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
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/65 px-3 pt-[8dvh] backdrop-blur-sm sm:px-4 sm:pt-[12dvh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Search Posterity" className="search-dialog w-full min-w-0 max-w-[560px] border border-line-strong bg-panel shadow-2xl animate-[rise_220ms_var(--ease-out-expo)_both] overflow-hidden rounded-2xl">
        <div className="search-dialog-input-row flex h-[60px] min-w-0 items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] shrink-0 text-muted" aria-hidden />
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
            placeholder="Search Posterity"
            aria-label="Search"
            className="search-dialog-input h-full w-0 min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] text-text shadow-none placeholder:text-faint"
          />
          <button type="button" onClick={onClose} aria-label="Close search" className="flex size-8 shrink-0 items-center justify-center rounded-full text-faint hover:bg-fg/[0.08] hover:text-text"><X className="size-[18px] shrink-0" aria-hidden /></button>
        </div>
        <ul role="listbox" className="max-h-[min(60dvh,480px)] overflow-y-auto py-1.5">
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
                    <span className="flex size-6 shrink-0 items-center justify-center">
                      <Icon className="size-[18px] shrink-0 text-faint" aria-hidden />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-text">{r.title}</span>
                    <span className="block truncate text-[12.5px] text-faint">{r.detail}</span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-faint">{r.kind}</span>
                  <CornerDownLeft className={cx("size-4 shrink-0 text-faint", i !== active && "invisible")} aria-hidden />
                </button>
              </li>
            );
          })}
          {q.trim().length >= 2 && (
            <li>
              <button type="button" onClick={() => go({ kind: 'page', href: `/explore?q=${encodeURIComponent(q.trim())}`, title: q, detail: '' })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] text-accent hover:bg-fg/[0.04]">
                <Search className="size-[18px] shrink-0" aria-hidden /><span className="min-w-0 break-words">Search the whole network for “{q.trim()}”</span>
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
