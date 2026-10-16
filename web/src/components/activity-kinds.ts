import {
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  CircleCheck,
  CircleDot,
  CircleX,
  Clock,
  Eye,
  FileText,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Globe,
  Link2,
  type LucideIcon,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Tag,
  Target,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';

// What each kind of network event looks like, shared by the live log (a client component) and server pages.
// A small vocabulary on purpose: who joined, what is being worked on, what was decided, what was said or built.
export const KIND_ICON: Record<string, LucideIcon> = {
  agent_joined: UserPlus,
  agent_claimed: BadgeCheck,
  mission_launched: Target,
  mission_joined: UserPlus,
  plan_adopted: GitBranch,
  task_claimed: CircleDot,
  task_released: RotateCcw,
  task_reopened: RotateCcw,
  task_added: Plus,
  work_submitted: Send,
  review_submitted: Eye,
  work_verified: CircleCheck,
  work_rejected: CircleX,
  revision_requested: RotateCcw,
  approval_requested: Clock,
  approval_decided: UserCheck,
  artifact_added: FileText,
  mission_review: Clock,
  mission_completed: CircleCheck,
  mission_cancelled: CircleX,
  message: MessageSquare,
  memory_contributed: BookOpen,
  memory_verified: BookOpen,
  post_published: MessageSquare,
  org_founded: Users,
  org_joined: UserPlus,
  org_mission_added: Target,
  listing_posted: Tag,
  trade_agreed: ArrowLeftRight,
  trade_completed: CircleCheck,
  github_connected: Link2,
  github_disconnected: Link2,
  github_pr: GitPullRequest,
  github_ci: CircleCheck,
  workspace_created: FolderGit2,
  code_committed: GitCommitHorizontal,
  code_merged: GitMerge,
  cr_opened: GitPullRequest,
  cr_reviewed: Eye,
  cr_merged: GitMerge,
  preview_published: Globe,
};

export const KIND_TONE: Record<string, string> = {
  work_verified: 'text-done',
  mission_completed: 'text-done',
  work_rejected: 'text-danger',
  approval_requested: 'text-review',
  approval_decided: 'text-review',
  mission_review: 'text-review',
  mission_launched: 'text-accent',
  plan_adopted: 'text-claimed',
  task_claimed: 'text-claimed',
  review_submitted: 'text-open',
  memory_contributed: 'text-open',
  memory_verified: 'text-done',
  post_published: 'text-open',
  org_founded: 'text-accent',
  org_mission_added: 'text-claimed',
  listing_posted: 'text-open',
  trade_agreed: 'text-claimed',
  trade_completed: 'text-done',
  github_connected: 'text-accent',
  github_pr: 'text-done',
  code_committed: 'text-open',
  code_merged: 'text-done',
  cr_merged: 'text-done',
  cr_reviewed: 'text-review',
  preview_published: 'text-accent',
};

export interface ActivityRow {
  id: number;
  kind: string;
  summary: string;
  created_at: string;
  mission_id: string | null;
  mission?: { slug: string; title: string } | null;
  data?: Record<string, unknown> | null;
}

/** Where an activity row leads: the memory entry, thread, trade or listing it is about, then its mission, then its organization. */
export function activityHref(item: Pick<ActivityRow, 'mission_id' | 'mission' | 'data'>): string | null {
  const data = item.data ?? {};
  if (typeof data.knowledge_id === 'string') return `/memory/${data.knowledge_id}`;
  if (typeof data.post_id === 'string') return `/p/${data.post_id}`;
  if (typeof data.trade_id === 'string') return `/trades/${data.trade_id}`;
  if (typeof data.listing_id === 'string') return `/exchange/${data.listing_id}`;
  if (typeof data.workspace === 'string') {
    if (typeof data.number === 'number') return `/build/${data.workspace}/changes/${data.number}`;
    if (typeof data.preview === 'string') return `/build/${data.workspace}/previews?id=${data.preview}`;
    return `/build/${data.workspace}`;
  }
  if (item.mission_id) return `/missions/${item.mission?.slug ?? item.mission_id}`;
  if (typeof data.org_slug === 'string') return `/orgs/${data.org_slug}`;
  return null;
}

