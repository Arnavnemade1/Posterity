// The GitHub connector's page: whether the GitHub App is installed, what it can see, and which of your agents' workspaces
// are linked to which repository. Fed by the page, or by the development mock screens.
import { ArrowUpRight, Check, GitBranch, GitPullRequest, Lock, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { GitHubMark } from '@/components/icons';
import { LiveRefresh } from '@/components/live';
import { ColumnHeader, Page } from '@/components/shell/column';
import { ReleaseInstallation } from '@/components/code/github-forms';
import { buttonClass, cx, Panel, Pill } from '@/components/ui';
import { type GitHubApp, type GitHubOverview, LINK_STATUS, MODE_LABEL } from '@/lib/github';

export interface GitHubViewProps {
  app: GitHubApp;
  overview: GitHubOverview;
  notice: { ok: boolean; message: string } | null;
  userId: string;
}

const BENEFITS = [
  { icon: GitBranch, title: 'Mirror every branch', body: 'Your agents’ branches appear in your repository as posterity/<branch>, so nothing they do is hidden from your own tools.' },
  { icon: GitPullRequest, title: 'Your CI checks their work', body: 'Each change request can open a pull request, and GitHub’s checks come back to Posterity as review evidence.' },
  { icon: RefreshCw, title: 'Or sync the default branch', body: 'Two-way sync keeps main in step: what merges here reaches GitHub, and what you push there comes back.' },
] as const;

const STEPS = [
  ['Install the app', 'Choose your account or organization on GitHub.'],
  ['Pick repositories', 'Only the ones you select are ever visible to Posterity.'],
  ['Link a workspace', 'From any workspace your agents maintain, choose the repository to connect it to.'],
] as const;

function Notice({ notice }: { notice: NonNullable<GitHubViewProps['notice']> }) {
  return (
    <p role={notice.ok ? 'status' : 'alert'} className={cx('flex items-start gap-2.5 border-b border-line px-4 py-3 text-[14px] sm:px-6', notice.ok ? 'bg-done/[0.07] text-done' : 'bg-danger/[0.07] text-danger')}>
      {notice.ok && <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.6} aria-hidden />}
      {notice.message}
    </p>
  );
}

function InstallButton({ app, installed }: { app: GitHubApp; installed: boolean }) {
  if (!app.install_url) return null;
  return (
    <a href={app.install_url} className={buttonClass(installed ? 'secondary' : 'primary', installed ? 'md' : 'lg')}>
      <GitHubMark className="size-4" />
      {installed ? 'Add repositories' : 'Connect GitHub'}
      <ArrowUpRight className="size-4" aria-hidden />
    </a>
  );
}

/** Before anything is installed: what connecting gives you, and the three steps. */
function Intro({ app }: { app: GitHubApp }) {
  return (
    <div className="px-4 py-8 sm:px-6">
      <h2 className="max-w-[24ch] text-[clamp(26px,3.4vw,34px)] font-bold leading-[1.1] tracking-[-0.03em] text-text">Put your agents’ code on GitHub.</h2>
      <p className="mt-3 max-w-[56ch] text-[15.5px] leading-relaxed text-muted">
        Install the Posterity GitHub app and your agents can mirror their workspaces to your repositories, with your CI checking what they build.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <InstallButton app={app} installed={false} />
        <span className="text-[13.5px] text-faint">You choose which repositories. You can uninstall at any time.</span>
      </div>

      <ul className="mt-9 grid gap-3 md:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="card p-4">
            <Icon className="size-5 text-muted" aria-hidden />
            <p className="mt-3 text-[15px] font-bold text-text">{title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-faint">{body}</p>
          </li>
        ))}
      </ul>

      <ol className="mt-9 space-y-5">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex gap-4">
            <span className="numeric flex size-8 shrink-0 items-center justify-center rounded-full bg-fg/[0.08] text-[13px] font-semibold text-text">{i + 1}</span>
            <div>
              <p className="text-[15.5px] font-semibold text-text">{title}</p>
              <p className="text-[14px] leading-relaxed text-faint">{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-8 max-w-[60ch] text-[13.5px] leading-relaxed text-faint">
        Linking a repository asks you first, unless your agent is set to autonomous. Private repositories stay private: their names are shown only to you.
      </p>
    </div>
  );
}

/** The app is not configured on this deployment: say so plainly rather than offering a button that cannot work. */
function NotReady() {
  return (
    <div className="px-4 py-12 sm:px-6">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-fg/[0.06]">
        <GitHubMark className="size-6 text-muted" />
      </span>
      <h2 className="mt-5 text-[24px] font-bold tracking-[-0.02em] text-text">GitHub isn’t available yet</h2>
      <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-muted">
        The Posterity GitHub app hasn’t been set up on this site, so repositories can’t be connected here. When it is, this page is where you install it.
      </p>
    </div>
  );
}

export function GitHubView({ app, overview, notice, userId }: GitHubViewProps) {
  const connected = overview.installations.length > 0;
  const repoCount = overview.installations.reduce((n, i) => n + i.repositories.length, 0);
  const linked = overview.installations.flatMap((i) => i.repositories).filter((r) => r.linked).length;
  const linkable = overview.workspaces.filter((w) => !w.remote);

  return (
    <Page wide>
      <ColumnHeader
        title="GitHub"
        subtitle={connected ? `${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'} · ${linked} linked to a workspace` : 'Connect your repositories'}
        back="/control"
        right={connected ? <InstallButton app={app} installed /> : undefined}
      />
      {notice && <Notice notice={notice} />}
      <LiveRefresh channel={`github:${userId}`} watch={[{ table: 'workspaces' }]} showBadge={false} />

      {!app.configured && !connected ? (
        <NotReady />
      ) : !connected ? (
        <Intro app={app} />
      ) : (
        <div className="space-y-5 px-4 py-5 sm:px-6">
          {overview.installations.map((i) => (
            <section key={i.id} className="card overflow-hidden">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-4">
                <GitHubMark className="size-5 text-text" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[17px] font-bold tracking-[-0.015em] text-text">{i.account}</h2>
                  <p className="text-[13.5px] text-faint">
                    {i.account_type === 'Organization' ? 'Organization' : 'Personal account'} · {i.repositories.length} {i.repositories.length === 1 ? 'repository' : 'repositories'}
                    {i.selection === 'all' ? ' · all repositories' : ''}
                    {i.github_login ? ` · connected by @${i.github_login}` : ''}
                  </p>
                </div>
                {i.suspended && <Pill tone="faint">Suspended</Pill>}
                {i.removed && <Pill tone="danger">Uninstalled</Pill>}
                <ReleaseInstallation installationId={i.id} account={i.account} />
              </header>
              {i.repositories.length ? (
                <ul className="divide-y divide-line">
                  {i.repositories.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3.5">
                      <span className="flex min-w-0 flex-1 basis-[220px] items-center gap-2 text-[14.5px] font-medium text-text">
                        {r.private && <Lock className="size-3.5 shrink-0 text-faint" aria-label="Private" />}
                        <a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">
                          {r.repo}
                        </a>
                        {r.archived && <span className="shrink-0 text-[12.5px] text-faint">archived</span>}
                      </span>
                      {r.linked ? (
                        <span className="flex flex-wrap items-center gap-2 text-[13.5px] text-faint">
                          <Link href={`/build/${r.linked.workspace}#github`} className="font-medium text-text hover:underline">
                            {r.linked.name}
                          </Link>
                          <span>{MODE_LABEL[r.linked.mode]}</span>
                          <Pill tone={LINK_STATUS[r.linked.status][1]}>{LINK_STATUS[r.linked.status][0]}</Pill>
                        </span>
                      ) : linkable.length ? (
                        <span className="text-[13.5px] text-faint">Not linked yet</span>
                      ) : (
                        <span className="text-[13.5px] text-faint">Not linked</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-5 text-[14px] text-faint">No repositories chosen yet. Add some on GitHub, then they show up here.</p>
              )}
            </section>
          ))}

          {linkable.length > 0 && (
            <Panel title="Ready to link">
              <p className="-mt-1 mb-3 text-[14px] leading-relaxed text-muted">These workspaces aren’t connected to a repository. Open one and choose a repository in its GitHub section.</p>
              <ul className="-mx-2 space-y-0.5">
                {linkable.map((w) => (
                  <li key={w.id}>
                    <Link href={`/build/${w.slug}#github`} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-fg/[0.04]">
                      <span className="min-w-0">
                        <span className="block truncate text-[14.5px] font-medium text-text">{w.name}</span>
                        <span className="block text-[13px] text-faint">
                          kept by @{w.agent} · {w.visibility}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-text">
                        Link <ArrowUpRight className="size-3.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <p className="px-1 text-[13.5px] leading-relaxed text-faint">
            Posterity only reads the repositories you select, and only writes to <span className="text-muted">posterity/*</span> branches unless you choose two-way sync. Disconnecting unlinks every workspace that used the account.
          </p>
        </div>
      )}
    </Page>
  );
}
