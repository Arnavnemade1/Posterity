'use client';

import { useActionState, useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/client-ui';
import { cx } from '@/components/ui';
import { linkWorkspace, releaseInstallation, resyncWorkspace, unlinkWorkspace } from '@/lib/actions/github';

const MODES = [
  { value: 'mirror', label: 'Mirror', body: 'Every branch is pushed to posterity/<branch>. Nothing else in the repository changes.' },
  { value: 'two_way', label: 'Two-way', body: 'Also keeps the default branch in sync: merges here reach GitHub, pushes there come back.' },
] as const;

/** Link a workspace to one of the owner's repositories. */
export function LinkGitHubForm({ workspaceId, repositories, privateWorkspace }: {
  workspaceId: string;
  repositories: { id: number; repo: string; private: boolean; installation: string }[];
  privateWorkspace: boolean;
}) {
  const [state, action] = useActionState(linkWorkspace, null);
  const [repoId, setRepoId] = useState(String(repositories[0]?.id ?? ''));
  const [mode, setMode] = useState<'mirror' | 'two_way'>('mirror');
  const chosen = repositories.find((r) => String(r.id) === repoId);
  // A private repository's code would become public here if it synced both ways into a public workspace.
  const twoWayBlocked = Boolean(chosen?.private && !privateWorkspace);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <label className="block">
        <span className="text-13 font-medium text-faint">Repository</span>
        <select name="repo_id" value={repoId} onChange={(e) => setRepoId(e.target.value)} className="field mt-1 h-9 w-full py-1 text-14">
          {repositories.map((r) => (
            <option key={r.id} value={r.id}>
              {r.repo}
              {r.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="space-y-1.5">
        <legend className="text-13 font-medium text-faint">Sync</legend>
        {MODES.map((m) => {
          const disabled = m.value === 'two_way' && twoWayBlocked;
          return (
            <label
              key={m.value}
              className={cx(
                'flex cursor-pointer gap-2.5 rounded-lg p-2.5 ring-1 ring-inset transition-colors',
                mode === m.value && !disabled ? 'bg-hover ring-fg/25' : 'ring-line hover:bg-hover',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                type="radio"
                name="mode"
                value={m.value}
                checked={mode === m.value && !disabled}
                disabled={disabled}
                onChange={() => setMode(m.value)}
                className="mt-0.5 accent-accent"
              />
              <span>
                <span className="block text-14 font-medium text-text">{m.label}</span>
                <span className="block text-13 leading-snug text-faint">
                  {disabled ? 'A private repository syncs both ways only with a private workspace.' : m.body}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="flex items-start gap-2.5 text-13 text-muted">
        <input type="checkbox" name="open_prs" defaultChecked className="mt-0.5 accent-accent" />
        <span>Open a pull request for each change request, so the repository&apos;s CI checks the agents&apos; work</span>
      </label>
      <SubmitButton size="sm" pendingLabel="Linking…">
        Link to GitHub
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function LinkActions({ workspaceId }: { workspaceId: string }) {
  const [syncState, sync] = useActionState(resyncWorkspace, null);
  const [unlinkState, unlink] = useActionState(unlinkWorkspace, null);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={sync}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <SubmitButton size="sm" variant="secondary" pendingLabel="Resyncing…">
            Resync
          </SubmitButton>
        </form>
        {confirm ? (
          <form action={unlink} className="flex gap-2">
            <input type="hidden" name="workspace_id" value={workspaceId} />
            <SubmitButton size="sm" variant="danger" pendingLabel="Unlinking…">
              Unlink
            </SubmitButton>
            <button type="button" onClick={() => setConfirm(false)} className="text-13 text-faint hover:text-text">
              Keep
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="text-13 font-medium text-faint transition-colors hover:text-text">
            Unlink…
          </button>
        )}
      </div>
      <FormMessage state={syncState ?? unlinkState} />
    </div>
  );
}

export function ReleaseInstallation({ installationId, account }: { installationId: number; account: string }) {
  const [state, action] = useActionState(releaseInstallation, null);
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className="text-13 font-medium text-faint transition-colors hover:text-text">
        Disconnect
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="installation_id" value={installationId} />
      <span className="text-13 text-muted">Unlink every workspace using {account}?</span>
      <SubmitButton size="sm" variant="danger" pendingLabel="Disconnecting…">
        Disconnect
      </SubmitButton>
      <button type="button" onClick={() => setConfirm(false)} className="text-13 text-faint hover:text-text">
        Cancel
      </button>
      <FormMessage state={state} />
    </form>
  );
}
