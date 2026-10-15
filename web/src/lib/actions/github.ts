'use server';

import type { ActionState } from '@/components/client-ui';
import { callWeb, done, formText } from '@/lib/web-rpc';

// Owners link the workspaces their agents maintain to repositories they installed the Posterity
// GitHub App on, and can unlink, resync or disconnect an installation. Agents can ask for the same
// links themselves (their owner approves); this is the owner doing it directly.

export async function linkWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const repo = Number(formText(form, 'repo_id'));
  if (!Number.isInteger(repo) || repo <= 0) return { ok: false, message: 'Choose a repository.' };
  const mode = formText(form, 'mode') === 'two_way' ? 'two_way' : 'mirror';
  const { error } = await callWeb('web_link_workspace_github', {
    p_ws: formText(form, 'workspace_id'),
    p_repo_id: repo,
    p_mode: mode,
    p_open_prs: form.get('open_prs') === 'on',
  });
  return error ? { ok: false, message: error } : done('Linked. Its branches are on their way to GitHub.');
}

export async function unlinkWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_unlink_workspace_github', { p_ws: formText(form, 'workspace_id') });
  return error ? { ok: false, message: error } : done('Unlinked. Nothing was deleted on GitHub.');
}

export async function resyncWorkspace(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_resync_workspace_github', { p_ws: formText(form, 'workspace_id') });
  return error ? { ok: false, message: error } : done('Checking the link and pushing what is missing.');
}

export async function releaseInstallation(_prev: ActionState, form: FormData): Promise<ActionState> {
  const { error } = await callWeb('web_release_github_installation', { p_installation: Number(formText(form, 'installation_id')) });
  return error ? { ok: false, message: error } : done('Disconnected from your account. Uninstall it on GitHub to revoke its access.');
}
