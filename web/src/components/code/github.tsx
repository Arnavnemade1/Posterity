// GitHub on Posterity's pages: the control room's installations, a workspace's link, and the marks on
// commits and change requests that came from (or went to) GitHub.
import { ArrowUpRight, GitPullRequest, Lock } from 'lucide-react';
import Link from 'next/link';
import { GitHubMark } from '@/components/icons';
import { cx, Pill } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { type GitHubApp, LINK_STATUS, MODE_LABEL, type WorkspaceGitHub } from '@/lib/github';
import { LinkActions, LinkGitHubForm } from './github-forms';

export { GitHubMark };

/** The small "from GitHub" mark beside a commit that came in from a repository. */
export function FromGitHub({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 text-[12px] font-medium text-faint', className)} title="Came from GitHub">
      <GitHubMark className="size-3" />
      GitHub
    </span>
  );
}

/** A change request's pull request on GitHub. */
export function PullRequestLink({ pr }: { pr: { number: number; url: string; state: string } }) {
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-text"
    >
      <GitHubMark className="size-3.5" />
      <GitPullRequest className="size-3.5" aria-hidden />
      Pull request #{pr.number}
      <span className="text-faint">· {pr.state}</span>
      <ArrowUpRight className="size-3.5 text-faint" aria-hidden />
    </a>
  );
}

function RepoName({ repo, url }: { repo: string | null; url: string | null }) {
  if (!repo) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13.5px] text-muted">
        <Lock className="size-3.5" aria-hidden /> A private repository
      </span>
    );
  }
  return (
    <a href={url ?? `https://github.com/${repo}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-[13px] text-text hover:underline">
      <span className="truncate">{repo}</span>
      <ArrowUpRight className="size-3.5 shrink-0 text-faint" aria-hidden />
    </a>
  );
}

// ----------------------------------------------------------------------------- the workspace panel

const JOB_LABEL: Record<string, string> = {
  link: 'Checked the link',
  push: 'Pushed',
  delete_ref: 'Removed',
  pr: 'Pull request',
  pull: 'Brought in GitHub changes',
  import: 'Imported',
};

/** The GitHub section of a workspace's side column; nothing when there is nothing to say. */
export function WorkspaceGitHubPanel({
  workspace,
  data,
  app,
  now,
}: {
  workspace: { id: string; slug: string; visibility: string };
  data: WorkspaceGitHub | null;
  app: GitHubApp;
  now: number;
}) {
  if (!data) return null;
  const imp = data.import;
  const remote = data.remote;
  if (!imp && !data.linked && !data.can_manage) return null;
  if (!data.linked && data.can_manage && !app.configured && !imp) return null;
  const [statusLabel, statusTone] = remote ? LINK_STATUS[remote.status] : ['', 'faint' as const];

  return (
    <section id="github" className="space-y-3 border-t border-line px-4 py-4">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-text">
        <GitHubMark /> GitHub
      </h2>

      {imp && (
        <p className="text-[13px] leading-relaxed text-muted">
          {imp.status === 'done' ? 'Imported from ' : imp.status === 'failed' ? 'Could not import ' : 'Importing '}
          {imp.repo ? (
            <a href={imp.url ?? `https://github.com/${imp.repo}`} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-text hover:underline">
              {imp.repo}
            </a>
          ) : (
            'a private repository'
          )}
          {imp.status === 'done' && imp.sha ? <span className="font-mono text-[12px] text-faint"> @ {imp.sha.slice(0, 7)}</span> : null}
          {imp.status === 'done' && imp.summary ? <span className="text-faint"> · {imp.summary}</span> : null}
          {imp.status === 'failed' && imp.error ? <span className="block text-danger">{imp.error}</span> : null}
          {(imp.status === 'queued' || imp.status === 'running') && <span className="text-faint">…</span>}
        </p>
      )}

      {remote && (
        <div className="space-y-2">
          <RepoName repo={remote.repo} url={remote.url} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={statusTone}>{statusLabel}</Pill>
            <Pill tone="faint" dot={false}>
              {MODE_LABEL[remote.mode]}
            </Pill>
            {remote.open_prs && (
              <Pill tone="faint" dot={false}>
                Pull requests
              </Pill>
            )}
          </div>
          {remote.status_detail && <p className="text-[12.5px] leading-relaxed text-muted">{remote.status_detail}</p>}
          {remote.status === 'diverged' && remote.sync_change_request ? (
            <Link href={`/build/${workspace.slug}/changes/${remote.sync_change_request}`} className="block text-[13px] font-medium text-text hover:underline">
              Merge change request #{remote.sync_change_request} →
            </Link>
          ) : null}
          <p className="text-[12px] text-faint">
            {remote.mode === 'two_way'
              ? `Branches go to posterity/*; ${remote.default_branch ?? 'the default branch'} syncs both ways.`
              : 'Branches go to posterity/* on GitHub.'}
            {remote.last_synced_at ? ` Synced ${timeAgo(remote.last_synced_at, now)}.` : ''}
          </p>
          {data.jobs && data.jobs.length > 0 && (
            <ul className="space-y-1 border-t border-line pt-2">
              {data.jobs.slice(0, 5).map((j, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className={cx('size-1.5 shrink-0 translate-y-[-1px] rounded-full', j.status === 'failed' ? 'bg-danger' : j.status === 'done' ? 'bg-done' : 'bg-claimed')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {JOB_LABEL[j.kind] ?? j.kind}
                    {j.branch ? <span className="font-mono"> {j.branch}</span> : null}
                    {j.error ? <span className="text-danger"> · {j.error}</span> : null}
                  </span>
                  <span className="shrink-0 text-faint">{timeAgo(j.finished_at ?? j.created_at, now)}</span>
                </li>
              ))}
            </ul>
          )}
          {data.can_manage && <LinkActions workspaceId={workspace.id} />}
        </div>
      )}

      {!remote && data.can_manage && app.configured && (
        data.repositories && data.repositories.length > 0 ? (
          <LinkGitHubForm workspaceId={workspace.id} repositories={data.repositories} privateWorkspace={workspace.visibility === 'private'} />
        ) : (
          <p className="text-[13px] leading-relaxed text-muted">
            Mirror this workspace to a repository, so GitHub runs its CI on your agents&apos; work.{' '}
            <Link href="/github" className="font-medium text-text hover:underline">
              Install the GitHub app
            </Link>{' '}
            on a repository first.
          </p>
        )
      )}
    </section>
  );
}
