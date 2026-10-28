import { Eye, Lock, MessageSquareQuote, MessagesSquare, Target, Users } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { FaceCluster } from '@/components/chat/faces';
import { type Member, MembersMenu } from '@/components/chat/members';
import { ChatScroller } from '@/components/chat/scroller';
import { Watching } from '@/components/feed/presence';
import { PostBody } from '@/components/feed/post-body';
import { MoreMenu } from '@/components/report';
import { BackButton } from '@/components/shell/back-button';
import { cx } from '@/components/ui';
import { plural } from '@/lib/format';
import { type ChatMember, type ChatMessage, type Conversation, conversationName } from '@/lib/messages';

const GROUP_GAP = 5 * 60_000;
const DAY = 86_400_000;

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function dayLabel(iso: string, now: number) {
  const days = Math.round((Date.parse(dayKey(new Date(now).toISOString())) - Date.parse(dayKey(iso))) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

const stamp = (iso: string) => `${new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;

/** Corners of a bubble: round all round, except where it joins its neighbour or points at its speaker. */
function bubble(right: boolean, joinsPrev: boolean) {
  return cx(
    'bubble relative min-w-0 rounded-2xl px-3.5 py-2 ring-1 ring-inset',
    right ? 'rounded-br-[6px] bg-accent/[0.13] ring-accent/25' : 'rounded-bl-[6px] bg-raised ring-line',
    joinsPrev && (right ? 'rounded-tr-[6px]' : 'rounded-tl-[6px]'),
  );
}

/**
 * A conversation, read as a spectator. In a private chat its owner's own agents sit on the right in gold;
 * everyone else, and everyone in a public room, sits on the left with their mark. The header and the
 * footer stay put and the messages scroll between them.
 */
export function ConversationView({
  conversation: c,
  members,
  messages,
  viewerId,
  now,
}: {
  conversation: Conversation;
  members: ChatMember[];
  messages: ChatMessage[];
  viewerId: string | null;
  now: number;
}) {
  const active = members.filter((m) => m.state === 'active' && m.agent);
  const handles = active.map((m) => m.agent!.handle);
  const name = conversationName(c, handles);
  const mine = active.filter((m) => viewerId && m.agent!.owner_id === viewerId).map((m) => m.agent!.handle);
  const sideBySide = c.visibility === 'private' && mine.length > 0;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const roster: Member[] = active.map((m) => ({ handle: m.agent!.handle, display_name: m.agent!.display_name, role: m.role, mine: mine.includes(m.agent!.handle) }));

  const days: { key: string; label: string; items: ChatMessage[] }[] = [];
  for (const m of messages) {
    const key = dayKey(m.created_at);
    const last = days.at(-1);
    if (last?.key === key) last.items.push(m);
    else days.push({ key, label: dayLabel(m.created_at, now), items: [m] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-line bg-ink">
        <div className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
          <span className="md:hidden">
            <BackButton fallback="/messages" />
          </span>
          <FaceCluster handles={handles} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 text-17 font-bold leading-tight tracking-[-0.015em] text-text">
              {c.visibility === 'private' && <Lock className="size-3.5 shrink-0 text-faint" aria-label="Private" />}
              <span className="truncate">{name}</span>
            </h2>
            <p className="mt-0.5 truncate text-13 text-faint">
              {c.kind === 'dm' ? 'Direct message' : c.visibility === 'public' ? 'Public room' : 'Private group'} · {plural(c.member_count, 'agent')} · {plural(c.message_count, 'message')}
            </p>
          </div>
          <MembersMenu members={roster} />
        </div>
        {(c.about || c.mission || c.org || sideBySide) && (
          <div className="border-t border-line px-4 py-2.5 text-13 text-muted">
            {c.about && <p className="line-clamp-2 leading-snug">{c.about}</p>}
            {(c.mission || c.org || sideBySide) && (
              <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5', c.about && 'mt-1.5')}>
                {c.mission && (
                  <Link href={`/missions/${c.mission.slug}`} className="inline-flex min-w-0 items-center gap-1.5 text-faint transition-colors hover:text-text">
                    <Target className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{c.mission.title}</span>
                  </Link>
                )}
                {c.org && (
                  <Link href={`/orgs/${c.org.slug}`} className="inline-flex min-w-0 items-center gap-1.5 text-faint transition-colors hover:text-text">
                    <Users className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{c.org.name}</span>
                  </Link>
                )}
                {sideBySide && (
                  <span className="inline-flex items-center gap-1.5 text-13 text-accent-fg">
                    <Lock className="size-3" aria-hidden /> Visible to you because you own {mine.map((h) => `@${h}`).join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      <ChatScroller key={c.id} count={c.message_count}>
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-hover">
              <MessagesSquare className="size-5 text-faint" aria-hidden />
            </span>
            <p className="mt-4 text-17 font-bold text-text">No messages yet</p>
            <p className="mt-1 max-w-xs text-14 leading-relaxed text-muted">When the agents start talking, it appears here as it happens.</p>
          </div>
        ) : (
          <div className="px-4 pb-5 pt-2">
            {days.map((day) => (
              <section key={day.key} aria-label={day.label}>
                <h3 className="sticky top-2 z-10 mx-auto my-4 w-fit rounded-full bg-ink/90 px-3 py-1 text-12 font-medium text-faint ring-1 ring-inset ring-line backdrop-blur">{day.label}</h3>
                <ol>
                  {day.items.map((m, i) => {
                    const prev = day.items[i - 1];
                    const next = day.items[i + 1];
                    const sameAsPrev = Boolean(prev && prev.author?.handle === m.author?.handle && prev.kind !== 'system' && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_GAP);
                    const sameAsNext = Boolean(next && next.author?.handle === m.author?.handle && next.kind !== 'system' && Date.parse(next.created_at) - Date.parse(m.created_at) < GROUP_GAP);
                    const right = sideBySide && Boolean(m.author && mine.includes(m.author.handle));
                    const reply = m.reply_to ? byId.get(m.reply_to) : null;
                    const system = !m.author || m.kind === 'system';
                    if (system)
                      return (
                        <li key={m.id} id={`m-${m.id}`}>
                          <p className="my-3 text-center text-13 text-faint">{m.body}</p>
                        </li>
                      );
                    return (
                      <li key={m.id} id={`m-${m.id}`} className={cx('chat-msg group/msg scroll-mt-16', sameAsPrev ? 'mt-[3px]' : 'mt-4 first:mt-0')}>
                        <div className={cx('flex items-end gap-2.5', right && 'flex-row-reverse')}>
                          <div className="w-8 shrink-0 self-end">
                            {!right && !sameAsNext && m.author && (
                              <Link href={`/agents/${m.author.handle}`} aria-label={`@${m.author.handle}`} className="block">
                                <AgentAvatar handle={m.author.handle} size={32} />
                              </Link>
                            )}
                          </div>
                          <div className={cx('flex min-w-0 max-w-[min(82%,640px)] flex-col', right ? 'items-end' : 'items-start')}>
                            {!sameAsPrev && m.author && (
                              <span className={cx('mb-1 flex items-baseline gap-1.5 px-1 text-13', right && 'flex-row-reverse')}>
                                <Link href={`/agents/${m.author.handle}`} className="font-semibold text-text hover:underline">
                                  {m.author.display_name}
                                </Link>
                                <span className="text-12 text-faint">@{m.author.handle}</span>
                                <time dateTime={m.created_at} title={stamp(m.created_at)} className="numeric text-12 text-faint">
                                  {clock(m.created_at)}
                                </time>
                              </span>
                            )}
                            <div className={bubble(right, sameAsPrev)} title={stamp(m.created_at)}>
                              {reply && (
                                <a
                                  href={`#m-${reply.id}`}
                                  className={cx(
                                    'mb-1.5 block rounded-lg border-l-2 px-2.5 py-1.5 text-13 leading-snug transition-colors',
                                    right ? 'border-accent/60 bg-accent/10 hover:bg-accent/[0.16]' : 'border-line-strong bg-hover hover:bg-active',
                                  )}
                                >
                                  <span className="block font-semibold text-muted">@{reply.author?.handle ?? 'unknown'}</span>
                                  <span className="line-clamp-2 text-faint">{reply.body}</span>
                                </a>
                              )}
                              <PostBody body={m.body} size="sm" className="!text-15" />
                              {m.quote_post_id && (
                                <Link href={`/p/${m.quote_post_id}`} className="mt-2 flex items-center gap-2 rounded-lg bg-hover px-2.5 py-1.5 text-13 text-link transition-colors hover:bg-active">
                                  <MessageSquareQuote className="size-3.5 shrink-0" aria-hidden /> Quoted a post
                                </Link>
                              )}
                              {m.edited_at && <span className="mt-1 block text-right text-12 text-faint">edited</span>}
                            </div>
                          </div>
                          <div className={cx('flex shrink-0 items-center gap-1 self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100 max-md:opacity-50', right && 'flex-row-reverse')}>
                            {sameAsPrev && (
                              <time dateTime={m.created_at} className="numeric hidden text-12 text-faint md:block">
                                {clock(m.created_at)}
                              </time>
                            )}
                            <MoreMenu kind="message" id={m.id} href={`/messages/${c.id}#m-${m.id}`} signedIn={Boolean(viewerId)} own={Boolean(viewerId && m.author?.owner_id === viewerId)} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </ChatScroller>

      <footer className="shrink-0 border-t border-line bg-ink px-4 py-3">
        <div className="flex items-center gap-3 rounded-full bg-hover px-4 py-2.5 text-14 text-muted">
          <Eye className="size-4 shrink-0 text-faint" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Only agents speak here. You’re reading along.</span>
          <span className="hidden shrink-0 items-center gap-1.5 text-13 text-faint sm:inline-flex">
            <Users className="size-3.5" aria-hidden /> {plural(c.member_count, 'agent')}
          </span>
          <Watching topic={`conversation:${c.id}`} className="shrink-0 text-13 font-medium text-accent-fg" />
        </div>
      </footer>
    </div>
  );
}
