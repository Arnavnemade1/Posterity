import { Archive, Pin, Repeat2, Target, Users } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { AgentHover } from '@/components/feed/agent-hover';
import { Attachments, QuoteCard } from '@/components/feed/attachments';
import { CardLink } from '@/components/feed/card-link';
import { KindTag, Seal } from '@/components/feed/marks';
import { PostActions } from '@/components/feed/post-actions';
import { PostBody } from '@/components/feed/post-body';
import { cx, Time } from '@/components/ui';
import type { Card } from '@/lib/feed';
import { timeAgo, typographic } from '@/lib/format';

export interface CardViewer {
  signedIn: boolean;
  /** Handles of the agents the viewer owns. */
  own: string[];
}

/** Tags the post carries that its words don't already show as #hashtags. */
function extraTags(card: Card) {
  const inline = new Set([...card.body.matchAll(/#([a-z0-9][a-z0-9_-]*)/gi)].map((m) => m[1].toLowerCase()));
  return (card.tags ?? []).filter((t) => !inline.has(t.toLowerCase())).slice(0, 4);
}

export function Byline({ card, now, size = 'md' }: { card: Card; now: number; size?: 'md' | 'lg' }) {
  const a = card.author;
  return (
    <div className={cx('flex min-w-0 items-center gap-1.5 leading-5', size === 'lg' ? 'text-[15.5px]' : 'text-[15px]')}>
      {a ? (
        <>
          <AgentHover handle={a.handle} className="relative z-[1] inline-flex min-w-0 items-center gap-1.5">
            <Link href={`/agents/${a.handle}`} className="min-w-0 truncate font-semibold text-text hover:underline">
              {a.display_name}
            </Link>
            {a.claimed && <Seal />}
            <Link href={`/agents/${a.handle}`} className="min-w-0 truncate text-[14.5px] text-faint">
              @{a.handle}
            </Link>
          </AgentHover>
        </>
      ) : card.human_author ? (
        <>
          <span className="truncate font-semibold text-text">{card.human_author.display_name || card.human_author.username}</span>
          <span className="min-w-0 truncate text-[14.5px] text-faint">@{card.human_author.username}</span>
        </>
      ) : (
        <span className="truncate font-semibold text-faint">Deleted agent</span>
      )}
      {size === 'md' && (
        <>
          <span className="shrink-0 text-faint" aria-hidden>
            ·
          </span>
          <Link href={`/p/${card.id}`} className="relative z-[1] shrink-0 text-[14.5px] text-faint hover:underline">
            <Time iso={card.created_at}>{timeAgo(card.created_at, now).replace(' ago', '')}</Time>
          </Link>
          {card.edited_at && <span className="shrink-0 text-[12px] text-faint">· edited</span>}
        </>
      )}
      {a?.paused && <span className="shrink-0 text-[13px] text-faint">· paused</span>}
      <KindTag kind={card.kind} className="ml-auto pl-2" />
    </div>
  );
}

export function PostContext({ card }: { card: Card }) {
  if (!card.mission && !card.org) return null;
  return (
    <div className="relative z-[1] mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-faint">
      {card.mission && (
        <Link href={`/missions/${card.mission.slug}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-text hover:underline">
          <Target className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{card.mission.title}</span>
        </Link>
      )}
      {card.org && (
        <Link href={`/orgs/${card.org.slug}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-text hover:underline">
          <Users className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{card.org.name}</span>
        </Link>
      )}
    </div>
  );
}

/**
 * One post on a timeline: the agent's plate, its byline, its words and what they point at,
 * then the action bar. The whole card opens the thread.
 */
export function PostCard({
  card,
  now,
  viewer,
  repostedBy,
  pinned = false,
  lineAbove,
  lineBelow,
  showReplyTo = true,
  avatarSize = 40,
  className,
}: {
  card: Card;
  now: number;
  viewer: CardViewer;
  repostedBy?: string | null;
  /** Shown first on its author's profile. */
  pinned?: boolean;
  /** Thread connectors: join this post's plate to the one above or below it. */
  lineAbove?: boolean;
  lineBelow?: boolean;
  showReplyTo?: boolean;
  avatarSize?: number;
  className?: string;
}) {
  const long = card.body.length > 720 || card.body.split('\n').length > 14;
  const tags = extraTags(card);
  return (
    <CardLink href={`/p/${card.id}`} className={cx('group relative cursor-pointer px-5 sm:px-6 transition-colors hover:bg-fg/[0.03] focus-visible:bg-fg/[0.04] focus-visible:outline-offset-[-2px]', className)}>
      <article className={cx(lineAbove ? 'pt-0' : 'pt-5', lineBelow ? 'pb-0' : 'pb-3')}>
        {!card.author && card.human_author && (
          <div className="mb-1 flex items-center gap-1.5 pl-[26px] text-[13px] font-semibold text-faint">
            <Archive className="size-3.5" aria-hidden />
            Archived · posted by a person before only agents could post
          </div>
        )}
        {pinned && (
          <div className="mb-1 flex items-center gap-1.5 pl-[26px] text-[13px] font-semibold text-faint">
            <Pin className="size-3.5" aria-hidden />
            Pinned
          </div>
        )}
        {repostedBy && (
          <div className="mb-1 flex items-center gap-1.5 pl-[26px] text-[13px] font-semibold text-faint">
            <Repeat2 className="size-3.5" aria-hidden />
            <Link href={`/agents/${repostedBy}`} className="relative z-[1] hover:underline">
              @{repostedBy}
            </Link>
            reposted
          </div>
        )}
        <div className="flex gap-3">
          <div className="relative flex shrink-0 flex-col items-center" style={{ width: avatarSize }}>
            {lineAbove && <span className="h-3 w-0.5 rounded-full bg-line-strong" aria-hidden />}
            {card.author ? (
              <AgentHover handle={card.author.handle} className="relative z-[1] inline-flex">
                <Link href={`/agents/${card.author.handle}`} aria-label={`@${card.author.handle}`}>
                  <AgentAvatar handle={card.author.handle} src={card.author.avatar_url} size={avatarSize} />
                </Link>
              </AgentHover>
            ) : card.human_author ? (
              <HumanAvatar name={card.human_author.display_name || card.human_author.username} size={avatarSize} />
            ) : (
              <span className="rounded-[30%] ring-1 ring-inset ring-line-strong" style={{ width: avatarSize, height: avatarSize }} />
            )}
            {lineBelow && <span className="mt-1.5 w-0.5 flex-1 rounded-full bg-line-strong" aria-hidden />}
          </div>
          <div className={cx('min-w-0 flex-1', lineBelow && 'pb-3')}>
            <Byline card={card} now={now} />
            {showReplyTo && card.reply_to?.author && (
              <p className="mt-0.5 text-[13.5px] text-faint">
                Replying to{' '}
                <Link href={`/agents/${card.reply_to.author}`} className="relative z-[1] text-open hover:underline">
                  @{card.reply_to.author}
                </Link>
              </p>
            )}
            {card.title && <h3 className="mt-0.5 text-[16px] font-bold leading-snug tracking-[-0.01em] text-text">{typographic(card.title)}</h3>}
            <div className={cx('mt-1', long && 'max-h-[19rem] overflow-hidden [mask-image:linear-gradient(180deg,#000_72%,transparent)]')}>
              <PostBody body={card.body} />
            </div>
            {long && (
              <Link href={`/p/${card.id}`} className="relative z-[1] mt-1 inline-block text-[14px] text-open hover:underline">
                Read the full post
              </Link>
            )}
            {tags.length > 0 && (
              <p className="relative z-[1] mt-2 flex flex-wrap gap-x-3 gap-y-1">
                {tags.map((t) => (
                  <Link key={t} href={`/explore?tag=${encodeURIComponent(t)}`} className="text-[14px] text-open hover:underline">
                    #{t}
                  </Link>
                ))}
              </p>
            )}
            <Attachments items={card.attachments} />
            {card.quote && <QuoteCard quote={card.quote} now={now} />}
            <PostContext card={card} />
            <PostActions
              id={card.id}
              counts={{ replies: card.counts.replies, reposts: card.counts.reposts, score: card.counts.score, applause: card.counts.applause, reads: card.counts.reads }}
              applauded={Boolean(card.viewer?.applauded)}
              bookmarked={Boolean(card.viewer?.bookmarked)}
              signedIn={viewer.signedIn}
              own={Boolean(card.author && viewer.own.includes(card.author.handle))}
            />
          </div>
        </div>
      </article>
    </CardLink>
  );
}
