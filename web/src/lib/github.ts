// The Posterity GitHub App from the web's side: whether it is set up (the API knows), the signed-in
// person's installations, and a workspace's link. Private repositories' names reach only the people
// the database says may see them.
import { cache } from 'react';
import { apiBase } from '@/lib/api';
import type { Tone } from '@/lib/status';
import { createClient } from '@/lib/supabase/server';

export interface GitHubApp {
  configured: boolean;
  slug: string | null;
  install_url: string | null;
  client_id: string | null;
}

/** Is the App set up on this deployment, and where to install it. Cached for a minute. */
export async function getGitHubApp(): Promise<GitHubApp> {
  try {
    const res = await fetch(`${apiBase()}/github/app`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as GitHubApp;
    return { configured: Boolean(data.configured), slug: data.slug ?? null, install_url: data.install_url ?? null, client_id: data.client_id ?? null };
  } catch {
    return { configured: false, slug: null, install_url: null, client_id: null };
  }
}

export type LinkStatus = 'linking' | 'active' | 'diverged' | 'paused' | 'error';

export interface GitHubRemote {
  repo: string | null;
  url: string | null;
  private: boolean;
  default_branch: string | null;
  mode: 'mirror' | 'two_way';
  open_prs: boolean;
  status: LinkStatus;
  status_detail?: string | null;
  sync_change_request?: number | null;
  linked_by?: string | null;
  last_synced_at: string | null;
}

export interface ImportState {
  repo: string | null;
  url: string | null;
  ref: string | null;
  private: boolean;
  status: 'queued' | 'running' | 'done' | 'failed';
  sha?: string | null;
  files?: number;
  summary?: string;
  error?: string;
  skipped?: string[];
  finished_at?: string;
}

export interface WorkspaceGitHub {
  linked: boolean;
  remote: GitHubRemote | null;
  can_manage: boolean;
  jobs: { kind: string; branch: string | null; status: string; error: string | null; created_at: string; finished_at: string | null }[] | null;
  repositories: { id: number; repo: string; private: boolean; installation: string }[] | null;
  pull_requests?: { change_request: number; number: number; url: string; state: 'open' | 'closed' | 'merged' }[] | null;
  import: ImportState | null;
}

/** A workspace's GitHub panel, as the signed-in person (or the public) may see it. */
export const getWorkspaceGitHub = cache(async (workspaceId: string): Promise<WorkspaceGitHub | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('web_workspace_github', { p_ws: workspaceId });
  if (error || !data) return null;
  return data as unknown as WorkspaceGitHub;
});

export interface Installation {
  id: number;
  account: string;
  account_type: 'User' | 'Organization' | 'Enterprise';
  selection: 'all' | 'selected';
  suspended: boolean;
  removed: boolean;
  github_login: string | null;
  repositories: {
    id: number;
    repo: string;
    private: boolean;
    archived: boolean;
    default_branch: string | null;
    linked: { workspace: string; name: string; mode: 'mirror' | 'two_way'; status: LinkStatus } | null;
  }[];
}

export interface GitHubOverview {
  installations: Installation[];
  workspaces: { id: string; slug: string; name: string; visibility: string; agent: string; remote: (GitHubRemote & { repo: string }) | null }[];
}

/** The signed-in person's installations and the workspaces their agents maintain. */
export async function getGitHubOverview(): Promise<GitHubOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('web_github_overview');
  if (error || !data) return { installations: [], workspaces: [] };
  return data as unknown as GitHubOverview;
}

export const LINK_STATUS: Record<LinkStatus, [string, Tone]> = {
  linking: ['Connecting', 'claimed'],
  active: ['In sync', 'done'],
  diverged: ['Both sides changed', 'review'],
  paused: ['Paused', 'faint'],
  error: ['Needs attention', 'danger'],
};

export const MODE_LABEL = { mirror: 'Mirror', two_way: 'Two-way' } as const;
