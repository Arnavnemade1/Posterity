import { ExternalLink, File as FileIcon, Folder, GitCommitHorizontal, History } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeView, languageOf } from '@/components/code/highlight';
import { Crumbs, filePath, RefMenu, shortSha } from '@/components/code/parts';
import { Markdown } from '@/components/markdown';
import { cx } from '@/components/ui';
import { apiBase } from '@/lib/api';
import {
  blobMeta,
  blobTexts,
  getLog,
  getManifest,
  listBranches,
  listDir,
  resolveRef,
  type WorkspaceRow,
} from '@/lib/code';
import { timeAgo } from '@/lib/format';
import { requestTime } from '@/lib/request-time';

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico']);

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

/** A folder or a file of a workspace at a ref: the code tab's body. */
export async function CodeBrowser({
  workspace: ws,
  path,
  refName: wanted,
  view,
}: {
  workspace: WorkspaceRow;
  path: string;
  refName?: string;
  view?: string;
}) {
  const [branches, resolved] = await Promise.all([listBranches(ws.id), resolveRef(ws, wanted)]);
  const base = `/build/${ws.slug}`;
  if (!resolved) {
    return (
      <div className="px-6 py-14 text-center">
        <p className="text-[20px] font-bold text-text">No branch or commit “{wanted}”</p>
        <p className="mt-2 text-[14px] text-faint">
          It may have been deleted, or never existed. <Link href={base} className="text-open hover:underline">Back to {ws.default_branch}</Link>.
        </p>
      </div>
    );
  }
  const now = requestTime();
  const manifest = await getManifest(resolved.commit);
  const refParam = resolved.branch === ws.default_branch ? null : resolved.branch ?? resolved.commit;
  const isFile = path !== '' && path in manifest;
  const isDir = path === '' || Object.keys(manifest).some((p) => p.startsWith(`${path}/`));
  if (!isFile && !isDir) notFound();

  const log = await getLog(ws.slug, resolved.branch ?? resolved.commit, null, 1, 0);
  const head = log?.commits[0] ?? null;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
      <RefMenu base={path ? filePath(base, path, null).split('?')[0] : base} current={resolved.label} branches={branches} />
      <Crumbs base={base} name={ws.slug} path={path} refName={refParam} />
      <Link
        href={`${base}/commits?${refParam ? `ref=${encodeURIComponent(refParam)}&` : ''}${path ? `path=${encodeURIComponent(path)}` : ''}`}
        className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-faint transition-colors hover:text-text"
      >
        <History className="size-4" aria-hidden /> History
      </Link>
    </div>
  );

  const latest = head && (
    <div className="flex items-center gap-2.5 border-b border-line bg-panel/40 px-4 py-2.5 text-[13px]">
      <GitCommitHorizontal className="size-4 shrink-0 text-open" aria-hidden />
      <Link href={`${base}/commit/${head.id.slice(0, 12)}`} className="min-w-0 flex-1 truncate text-text hover:underline">
        {head.message.split('\n')[0]}
      </Link>
      <span className="hidden shrink-0 text-faint sm:inline">
        {head.author ? `@${head.author} · ` : ''}
        {timeAgo(head.created_at, now)}
      </span>
      <Link href={`${base}/commit/${head.id.slice(0, 12)}`} className="shrink-0 font-mono text-[12px] text-faint hover:text-text">
        {shortSha(head.id)}
      </Link>
    </div>
  );

  if (isFile) {
    const sha = manifest[path];
    const [meta] = [(await blobMeta([sha])).get(sha)];
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const raw = ws.visibility === 'private' ? null : `${apiBase()}/workspaces/${ws.slug}/files?path=${encodeURIComponent(path)}&ref=${encodeURIComponent(resolved.commit)}&raw=true`;
    const text = meta && !meta.is_binary ? (await blobTexts([sha])).get(sha) ?? '' : null;
    const markdown = text !== null && /^(md|markdown)$/.test(ext) && view !== 'code';
    return (
      <div>
        {toolbar}
        {latest}
        <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[12.5px] text-faint">
          <span className="font-mono text-muted">{path.split('/').pop()}</span>
          {meta && <span>{size(meta.size)}</span>}
          {text !== null && <span>{text === '' ? 0 : text.replace(/\n$/, '').split('\n').length} lines</span>}
          {text !== null && languageOf(path) && <span>{languageOf(path)}</span>}
          <span className="ml-auto flex items-center gap-4">
            {text !== null && /^(md|markdown)$/.test(ext) && (
              <Link href={`${filePath(base, path, null)}?${new URLSearchParams({ ...(refParam ? { ref: refParam } : {}), view: markdown ? 'code' : 'preview' })}`} className="hover:text-text">
                {markdown ? 'View source' : 'View rendered'}
              </Link>
            )}
            {raw && (
              <a href={raw} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-text">
                Raw <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </span>
        </div>
        {text !== null ? (
          markdown ? (
            <div className="px-5 py-5">
              <Markdown>{text}</Markdown>
            </div>
          ) : (
            <CodeView path={path} code={text} className="py-3" />
          )
        ) : meta ? (
          <div className="px-5 py-8 text-center">
            {raw && IMAGES.has(ext) ? (
              // eslint-disable-next-line @next/next/no-img-element -- a user-supplied image from the API; next/image has nothing to optimise
              <img src={raw} alt={path} className="mx-auto max-h-[480px] max-w-full rounded-lg ring-1 ring-line" />
            ) : (
              <p className="text-[14px] text-faint">Binary file, {size(meta.size)}.</p>
            )}
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-[14px] text-faint">This file’s contents are not available to you.</p>
        )}
      </div>
    );
  }

  const entries = listDir(manifest, path);
  const metas = await blobMeta(entries.flatMap((e) => (e.sha ? [e.sha] : [])));
  const readme = entries.find((e) => e.type === 'file' && /^readme(\.md|\.markdown)?$/i.test(e.name));
  const readmeText = readme?.sha && /\.(md|markdown)$/i.test(readme.name) ? (await blobTexts([readme.sha])).get(readme.sha) ?? null : null;

  return (
    <div>
      {toolbar}
      {latest}
      {entries.length ? (
        <ul className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.path}>
              <Link href={filePath(base, e.path, refParam)} className="flex items-center gap-3 px-4 py-2.5 text-[14px] transition-colors hover:bg-fg/[0.03]">
                {e.type === 'dir' ? <Folder className="size-4 shrink-0 text-open" aria-hidden /> : <FileIcon className="size-4 shrink-0 text-faint" aria-hidden />}
                <span className={cx('min-w-0 flex-1 truncate', e.type === 'dir' ? 'font-medium text-text' : 'font-mono text-[13px] text-prose')}>{e.name}</span>
                <span className="numeric shrink-0 text-[12px] text-faint">
                  {e.type === 'dir' ? `${e.files} file${e.files === 1 ? '' : 's'}` : e.sha && metas.get(e.sha) ? size(metas.get(e.sha)!.size) : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 py-12 text-center text-[14px] text-faint">
          This workspace has no files yet. An agent commits them with <code className="font-mono text-muted">POST /workspaces/{ws.slug}/commits</code>.
        </p>
      )}
      {readmeText && (
        <section className="border-t border-line px-5 py-5">
          <h2 className="mb-3 font-mono text-[12.5px] text-faint">{readme!.name}</h2>
          <Markdown>{readmeText}</Markdown>
        </section>
      )}
    </div>
  );
}
