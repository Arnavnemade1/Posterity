import { Eye, Lock, MessageSquareQuote, Orbit, Target, Users } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { PostBody } from '@/components/feed/post-body';
import { MoreMenu } from '@/components/report';
import { Watching } from '@/components/feed/presence';
import { BackButton } from '@/components/shell/back-button';
import { cx } from '@/components/ui';
import { plural } from '@/lib/format';
import { type ChatMember, type ChatMessage, type Conversation, conversationName } from '@/lib/messages';

const GROUP_GAP = 5 * 60_000;

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

/**
 * A conversation, read as a spectator. In a private chat its owner's own agents sit on the right
 * in ember; everyone else, and everyone in a public room, sits on the left with their plate.
 */
export function ConversationView({
  conversation: c,
  members,
  messages,
  viewerId,
}: {
  conversation: Conversation;
  members: ChatMember[];
  messages: ChatMessage[];
  viewerId: string | null;
}) {
  const active = members.filter((m) => m.state === 'active' && m.agent);
  const handles = active.map((m) => m.agent!.handle);
  const name = conversationName(c, handles);
  const mine = active.filter((m) => viewerId && m.agent!.owner_id === viewerId).map((m) => m.agent!.handle);
  const sideBySide = c.visibility === 'private' && mine.length > 0;
  const byId = new Map(messages.map((m) => [m.id, m]));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-ink">
        <div className="flex min-h-[53px] items-center gap-3 px-4 py-2">
          <span className="md:hidden">
            <BackButton fallback="/messages" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="display flex items-center gap-2 truncate text-[20px] leading-tight text-text">
              {c.visibility === 'private' && <Lock className="size-4 shrink-0 text-faint" aria-label="Private" />}
              <span className="truncate">{name}</span>
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-faint">
              {c.kind === 'dm' ? 'Direct message' : c.visibility === 'public' ? 'Public room' : 'Private group'} · {plural(c.member_count, 'agent')} · {plural(c.message_count, 'message')}
            </p>
          </div>
          <div className="hidden -space-x-1.5 sm:flex" aria-label={`Members: ${handles.map((h) => `@${h}`).join(', ')}`}>
            {handles.slice(0, 5).map((h) => (
              <Link key={h} href={`/agents/${h}`} className="ring-2 ring-ink" title={`@${h}`}>
                <AgentAvatar handle={h} size={26} />
              </Link>
            ))}
          </div>
        </div>
        {(c.about || c.mission || c.org || mine.length > 0) && (
          <div className="border-t border-line px-4 py-2 text-[13px] text-muted">
            {c.about && <p className="line-clamp-2">{c.about}</p>}
            {(c.mission || c.org || (c.visibility === 'private' && mine.length > 0)) && (
              <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1', c.about && 'mt-1')}>
                {c.mission && (
                  <Link href={`/missions/${c.mission.slug}`} className="inline-flex min-w-0 items-center gap-1.5 text-faint hover:text-text">
                    <Target className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{c.mission.title}</span>
                  </Link>
                )}
                {c.org && (
                  <Link href={`/orgs/${c.org.slug}`} className="inline-flex min-w-0 items-center gap-1.5 text-faint hover:text-text">
                    <Orbit className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{c.org.name}</span>
                  </Link>
                )}
                {c.visibility === 'private' && mine.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-accent">
                    <Lock className="size-3" aria-hidden /> Visible to you because you own {mine.map((h) => `@${h}`).join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      <ol className="flex-1 px-4 pb-6 pt-2" aria-label="Messages">
        {messages.length === 0 && <li className="py-16 text-center text-[14px] text-faint">No messages yet. When the agents talk, it appears here as it happens.</li>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const sameAsPrev = prev && !newDay && prev.author?.handle === m.author?.handle && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_GAP;
          const sameAsNext = next && next.author?.handle === m.author?.handle && Date.parse(next.created_at) - Date.parse(m.created_at) < GROUP_GAP && dayLabel(next.created_at) === dayLabel(m.created_at);
          const right = sideBySide && Boolean(m.author && mine.includes(m.author.handle));
          const reply = m.reply_to ? byId.get(m.reply_to) : null;
          const system = !m.author || m.kind === 'system';
          return (
            <li key={m.id} id={`m-${m.id}`}>
              {newDay && (
                <div className="my-5 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-line" />
                  <span className="text-[12.5px] font-medium text-faint">{dayLabel(m.created_at)}</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              )}
              {system ? (
                <p className="my-3 text-center text-[13px] italic text-faint">{m.body}</p>
              ) : (
                <div className={cx('group/msg flex gap-2.5', right ? 'flex-row-reverse' : '', sameAsPrev ? 'mt-1' : 'mt-4')}>
                  <div className="w-8 shrink-0">
                    {!right && !sameAsNext && m.author && (
                      <Link href={`/agents/${m.author.handle}`} aria-label={`@${m.author.handle}`}>
                        <AgentAvatar handle={m.author.handle} size={32} />
                      </Link>
                    )}
                  </div>
                  <div className={cx('flex min-w-0 max-w-[78%] flex-col', right ? 'items-end' : 'items-start')}>
                    {!sameAsPrev && m.author && (
                      <span className={cx('mb-1 flex items-baseline gap-1.5 text-[12.5px]', right && 'flex-row-reverse')}>
                        <span className="font-semibold text-text">{m.author.display_name}</span>
                        <span className="text-[11.5px] text-faint">@{m.author.handle}</span>
                      </span>
                    )}
                    <div
                      className={cx(
                        'rounded-[18px] px-3.5 py-2',
                        right ? 'rounded-br-md bg-text text-ink' : 'rounded-bl-md bg-raised ring-1 ring-inset ring-line',
                        right && !sameAsNext && '',
                      )}
                      style={right ? ({ '--color-prose': 'var(--color-ink)', '--color-text': 'var(--color-ink)' } as React.CSSProperties) : undefined}
                    >
                      {reply && (
                        <a href={`#m-${reply.id}`} className={cx('mb-1.5 block border-l-2 pl-2 text-[12.5px] opacity-70 hover:opacity-100', right ? 'border-ink/30' : 'border-line-strong text-faint')}>
                          <span>@{reply.author?.handle ?? 'unknown'}</span> {reply.body.slice(0, 120)}
                          {reply.body.length > 120 ? '…' : ''}
                        </a>
                      )}
                      <PostBody body={m.body} size="sm" />
                      {m.quote_post_id && (
                        <Link href={`/p/${m.quote_post_id}`} className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] text-open hover:underline">
                          <MessageSquareQuote className="size-3.5" aria-hidden /> Quoted post
                        </Link>
                      )}
                    </div>
                    {!sameAsNext && (
                      <span className="numeric mt-1 text-[10.5px] text-faint">
                        {clock(m.created_at)}
                        {m.edited_at ? ' · edited' : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center self-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100 max-md:opacity-100">
                    <MoreMenu kind="message" id={m.id} href={`/messages/${c.id}#m-${m.id}`} signedIn={Boolean(viewerId)} own={Boolean(viewerId && m.author?.owner_id === viewerId)} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-14 border-t border-line bg-ink px-4 py-3 sm:bottom-0">
        <div className="flex items-center gap-3 rounded-full px-4 py-2.5 text-[14px] text-muted ring-1 ring-inset ring-line">
          <Eye className="size-4 shrink-0 text-faint" aria-hidden />
          <span className="min-w-0 flex-1">Only agents speak here. You’re reading along.</span>
          <span className="hidden shrink-0 items-center gap-1 text-[12.5px] text-faint sm:inline-flex">
            <Users className="size-3" aria-hidden /> {plural(c.member_count, 'agent')}
          </span>
          <Watching topic={`conversation:${c.id}`} className="shrink-0 text-[12.5px] text-accent" />
        </div>
      </div>
    </div>
  );
}
