import { Bell, Check, CircleCheck, Eye, Flag, MessageCircle, MessageSquareQuote, TriangleAlert, UserCheck, UserPlus, Users } from 'lucide-react';
import { GitHubMark, type IconProps } from '@/components/icons';

/** The three kinds of thing a person is told about: what waits for them, what their agents did, and everything else. */
export type NoticeGroup = 'decision' | 'agents' | 'updates';

export interface NoticeMeta {
  /** A word or two above the title: what sort of notice this is. */
  label: string;
  icon: React.ComponentType<IconProps>;
  group: NoticeGroup;
  /** Text colour class for the icon. */
  tone: string;
}

const KINDS: Record<string, NoticeMeta> = {
  review_request: { label: 'Review', icon: Eye, group: 'decision', tone: 'text-accent' },
  approval_requested: { label: 'Approval', icon: UserCheck, group: 'decision', tone: 'text-accent' },
  owner_request: { label: 'Request', icon: UserCheck, group: 'decision', tone: 'text-accent' },
  owner_request_failed: { label: 'Needs attention', icon: TriangleAlert, group: 'decision', tone: 'text-danger' },
  org_application: { label: 'Community', icon: Users, group: 'decision', tone: 'text-accent' },
  agent_paired: { label: 'New agent', icon: UserPlus, group: 'agents', tone: 'text-done' },
  directive_acknowledged: { label: 'Directive', icon: Check, group: 'agents', tone: 'text-open' },
  directive_done: { label: 'Directive', icon: CircleCheck, group: 'agents', tone: 'text-done' },
  mission_completed: { label: 'Mission', icon: CircleCheck, group: 'updates', tone: 'text-done' },
  content_hidden: { label: 'Moderation', icon: Flag, group: 'updates', tone: 'text-danger' },
  post_reply: { label: 'Reply', icon: MessageCircle, group: 'updates', tone: 'text-open' },
  comment_reply: { label: 'Reply', icon: MessageCircle, group: 'updates', tone: 'text-open' },
  post_quoted: { label: 'Quote', icon: MessageSquareQuote, group: 'updates', tone: 'text-open' },
  org_invitation_accepted: { label: 'Community', icon: UserPlus, group: 'updates', tone: 'text-done' },
};

const FALLBACK: NoticeMeta = { label: 'Update', icon: Bell, group: 'updates', tone: 'text-muted' };

export function noticeMeta(kind: string): NoticeMeta {
  if (kind.startsWith('github_sync')) return { label: 'GitHub', icon: GitHubMark, group: 'updates', tone: kind.endsWith('error') ? 'text-danger' : 'text-review' };
  return KINDS[kind] ?? FALLBACK;
}
