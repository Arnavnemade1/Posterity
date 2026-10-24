'use client';

import { ChevronRight, File as FileIcon, Folder, FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { cx } from '@/components/ui';
import { listFolder } from '@/lib/actions/code';
import type { DirEntry } from '@/lib/code';

const href = (base: string, path: string, ref: string | null) => `${base}/files/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;

/**
 * The workspace's files as a tree beside the code. Folders open and close in place, loading their entries
 * the first time (the server sends the ones along the open path up front), so moving about a large
 * repository never reloads the page. Files are links; the open one is marked.
 */
export function FileTree({
  base,
  slug,
  commit,
  refParam,
  active,
  initial,
}: {
  base: string;
  slug: string;
  commit: string;
  refParam: string | null;
  /** The path open in the pane at the right. */
  active: string;
  /** Entries by folder path ('' is the root), for the folders already known. */
  initial: Record<string, DirEntry[]>;
}) {
  const ancestors = active ? active.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/')) : [];
  // A folder you are looking at (the active path is a folder) opens too.
  const [open, setOpen] = useState<Set<string>>(() => new Set([...ancestors, ...(initial[active] ? [active] : [])]));
  const [cache, setCache] = useState<Record<string, DirEntry[]>>(initial);
  const [loading, setLoading] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (path: string) => {
    const next = new Set(open);
    if (next.has(path)) {
      next.delete(path);
      setOpen(next);
      return;
    }
    next.add(path);
    setOpen(next);
    if (cache[path]) return;
    setLoading(path);
    startTransition(async () => {
      const entries = await listFolder(slug, commit, path);
      setCache((c) => ({ ...c, [path]: entries }));
      setLoading((l) => (l === path ? null : l));
    });
  };

  const rows = (folder: string, depth: number): React.ReactNode => {
    const entries = cache[folder];
    if (!entries) return null;
    return entries.map((e) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (e.type === 'file') {
        const on = e.path === active;
        return (
          <li key={e.path}>
            <Link
              href={href(base, e.path, refParam)}
              aria-current={on ? 'page' : undefined}
              style={pad}
              className={cx('flex h-7 items-center gap-2 rounded-md pr-2 text-13 transition-colors duration-100', on ? 'bg-selected text-text' : 'text-muted hover:bg-hover hover:text-text')}
            >
              <FileIcon className="size-3.5 shrink-0 text-faint" aria-hidden />
              <span className="truncate font-mono text-12">{e.name}</span>
            </Link>
          </li>
        );
      }
      const isOpen = open.has(e.path);
      return (
        <li key={e.path}>
          <button
            type="button"
            onClick={() => toggle(e.path)}
            aria-expanded={isOpen}
            style={pad}
            className={cx('flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-13 transition-colors duration-100 hover:bg-hover', e.path === active ? 'text-text' : 'text-prose')}
          >
            <ChevronRight className={cx('size-3 shrink-0 text-faint transition-transform duration-150', isOpen && 'rotate-90', loading === e.path && 'animate-pulse')} aria-hidden />
            {isOpen ? <FolderOpen className="size-3.5 shrink-0 text-accent-fg" aria-hidden /> : <Folder className="size-3.5 shrink-0 text-accent-fg" aria-hidden />}
            <span className="truncate font-medium">{e.name}</span>
          </button>
          {isOpen && <ul>{rows(e.path, depth + 1)}</ul>}
        </li>
      );
    });
  };

  return (
    <nav aria-label="Files" className="text-13">
      <ul>{rows('', 0)}</ul>
    </nav>
  );
}
