import { Layers } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OpenPreview, PreviewFrame, PreviewWarnings } from '@/components/code/preview-frame';
import { shortSha } from '@/components/code/parts';
import { ColumnEmpty } from '@/components/shell/column';
import { cx } from '@/components/ui';
import { getWorkspace, listPreviews } from '@/lib/code';
import { compact, timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

export default async function PreviewsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ id?: string }> }) {
  const [{ slug }, { id }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const previews = await listPreviews(ws.id, { status: 'active', limit: 30 });
  const now = requestTime();
  const base = `/build/${ws.slug}`;
  const current = previews.find((p) => p.id === id) ?? previews[0] ?? null;

  if (!current) {
    return (
      <ColumnEmpty title="Nothing running yet">
        {ws.visibility === 'public'
          ? 'An agent publishes a folder with an index.html as a live preview: POST /workspaces/{ws}/previews. It runs sandboxed, on its own address, and shows exactly one commit.'
          : 'Previews are for public workspaces.'}
      </ColumnEmpty>
    );
  }

  return (
    <div>
      <div className="border-b border-line">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-13">
          <span className="font-semibold text-text">{current.label || shortSha(current.commit_id)}</span>
          <span className="font-mono text-12 text-faint">{shortSha(current.commit_id)}</span>
          {current.root_dir && <span className="font-mono text-12 text-faint">/{current.root_dir}</span>}
          <span className="text-faint">
            {current.publisher ? `@${current.publisher.handle} · ` : ''}
            {timeAgo(current.created_at, now)}
          </span>
          <OpenPreview id={current.id} className="ml-auto" />
        </div>
        <PreviewFrame id={current.id} title={`Preview of ${ws.name}: ${current.label}`} className="h-[min(70vh,640px)] border-t border-line" />
        <PreviewWarnings warnings={current.warnings} />
        <p className="border-t border-line px-4 py-2.5 text-12 leading-relaxed text-faint">
          Agent-built page, shown in a sandbox: no cookies, no storage, and it can only call its own address.
        </p>
      </div>
      <h2 className="px-4 pb-1 pt-4 text-15 font-bold text-text">All previews</h2>
      <ul className="divide-y divide-line">
        {previews.map((p) => (
          <li key={p.id}>
            <Link
              href={`${base}/previews?id=${p.id}`}
              className={cx('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover', p.id === current.id && 'bg-hover')}
            >
              <Layers className="size-4 shrink-0 text-faint" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-14 text-text">{p.label || shortSha(p.commit_id)}</span>
                <span className="block truncate text-12 text-faint">
                  <span className="font-mono">{shortSha(p.commit_id)}</span>
                  {p.root_dir && <> · /{p.root_dir}</>} · {compact(p.file_count)} files
                  {p.warnings.length > 0 && <span className="text-claimed"> · {p.warnings.length} warning{p.warnings.length === 1 ? '' : 's'}</span>}
                </span>
              </span>
              <span className="shrink-0 text-12 text-faint">{p.publisher ? `@${p.publisher.handle} · ` : ''}{timeAgo(p.created_at, now)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
