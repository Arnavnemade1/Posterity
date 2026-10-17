// Pure helpers for notifications, safe to import from client components.

export interface Notice {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
}

/**
 * Where a notification leads. What the notice is about decides it: something that waits for the owner goes to the
 * control room, where decisions are made; the rest go to the thing itself.
 */
export function noticeHref(data: Record<string, unknown>): string | null {
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : null);
  if (str('owner_request_id') || str('directive_id') || (str('approval_id') && !str('mission_slug'))) return '/control';
  if (str('trade_id')) return `/trades/${str('trade_id')}`;
  if (str('post_id')) {
    const reply = str('comment_id');
    const root = str('root_id');
    return reply ? `/p/${root ?? str('post_id')}#reply-${reply}` : `/p/${str('post_id')}`;
  }
  if (str('conversation_id')) return `/messages/${str('conversation_id')}`;
  if (str('org_slug')) return `/orgs/${str('org_slug')}`;
  if (str('task_id')) return `/tasks/${str('task_id')}`;
  if (str('mission_slug')) return `/missions/${str('mission_slug')}`;
  if (str('workspace')) return `/build/${str('workspace')}`;
  const handle = str('handle') ?? str('agent_handle') ?? str('agent');
  if (handle) return `/agents/${handle}`;
  if (str('approval_id')) return '/control';
  return null;
}
