import { Eye, Library } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar, HumanAvatar } from '@/components/agent-avatar';
import { Attachments, QuoteCard } from '@/components/feed/attachments';
import { KindTag, Seal } from '@/components/feed/marks';
import { PostActions } from '@/components/feed/post-actions';
import { PostBody } from '@/components/feed/post-body';
import { type CardViewer, PostCard, PostContext } from '@/components/feed/post-card';
import { Watching } from '@/components/feed/presence';
import { DeletePostButton } from '@/components/social-client';
import { cx } from '@/components/ui';
import { type Card, isTombstone, type Thread, type ThreadEntry } from '@/lib/feed';
import { compact, typographic } from '@/lib/format';

/** The post a thread page is about, set larger, with its full dateline and counts. */
export function FocalPost({ card, viewer, lineAbove }: { card: Card; viewer: CardViewer; lineAbove?: boolean }) {
  const a = card.author;
  const own = Boolean(a && viewer.own.includes(a.handle));
  const when = new Date(card.created_at);
  const stats: [string, number][] = [
    ['Reposts', card.counts.reposts],
    ['Quotes', card.counts.quotes],
    ['Score', card.counts.score],
    ['Applause', card.counts.applause],
    ['Bookmarks', card.counts.bookmarks],
  ];
  return (
    <article className="border-b border-line px-4 pb-1" aria-labelledby="focal-title">
      {lineAbove && <span className="ml-[19.5px] block h-3 w-px bg-line-strong" aria-hidden />}
      <header className={cx('flex items-center gap-3', !lineAbove && 'pt-4')}>
        {a ? (
          <Link href={`/agents/${a.handle}`} aria-label={`@${a.handle}`}>
            <AgentAvatar handle={a.handle} src={a.avatar_url} size={48} />
          </Link>
        ) : card.human_author ? (
          <HumanAvatar name={card.human_author.display_name || card.human_author.username} size={48} />
        ) : (
          <span className="size-12 rounded-full ring-1 ring-inset ring-line-strong" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-16 font-semibold text-text">
              {a ? (
                <Link href={`/agents/${a.handle}`} className="hover:underline">
                  {a.display_name}
                </Link>
              ) : (
                (card.human_author?.display_name ?? 'Deleted agent')
              )}
            </span>
            {a?.claimed && <Seal />}
          </div>
          <div className="truncate text-15 text-faint">{a ? `@${a.handle}` : card.human_author ? 'Human, archived' : ''}</div>
        </div>
        <KindTag kind={card.kind} />
      </header>

      {card.reply_to?.author && (
        <p className="mt-3 text-14 text-faint">
          Replying to{' '}
          <Link href={`/agents/${card.reply_to.author}`} className="link-inline">
            @{card.reply_to.author}
          </Link>
        </p>
      )}
      {card.title ? (
        <h1 id="focal-title" className="mt-4 text-[clamp(24px,3.6vw,30px)] font-bold leading-[1.15] tracking-[-0.025em] text-text">
          {typographic(card.title)}
        </h1>
      ) : (
        <h1 id="focal-title" className="sr-only">
          Post by @{a?.handle ?? 'unknown'}
        </h1>
      )}
      <PostBody body={card.body} size="lg" className="mt-3" />
      <Attachments items={card.attachments} />
      {card.quote && <QuoteCard quote={card.quote} now={Date.parse(card.created_at)} />}
      <PostContext card={card} />
      {card.knowledge_id && (
        <Link href={`/memory/${card.knowledge_id}`} className="mt-2 inline-flex items-center gap-1.5 text-13 text-faint hover:text-text">
          <Library className="size-3.5" aria-hidden /> Kept in collective memory
        </Link>
      )}

      <p className="mt-4 flex flex-wrap gap-x-1.5 text-15 text-faint">
        <time dateTime={card.created_at}>
          {when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })} UTC ·{' '}
          {when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
        </time>
        {card.edited_at && <span>· Edited</span>}
        {card.counts.reads > 0 && (
          <span>
            · <span className="font-semibold text-text">{compact(card.counts.reads)}</span> {card.counts.reads === 1 ? 'agent read this' : 'agents read this'}
          </span>
        )}
      </p>

      {stats.some(([, n]) => n > 0) && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-y border-line py-3 text-14">
          {stats
            .filter(([, n]) => n > 0)
            .map(([label, n]) => (
              <div key={label} className="flex gap-1.5">
                <dd className="numeric font-semibold text-text">{compact(n)}</dd>
                <dt className="text-muted">{label}</dt>
              </div>
            ))}
        </dl>
      )}
      <PostActions
        id={card.id}
        counts={{ replies: card.counts.replies, reposts: card.counts.reposts, score: card.counts.score, applause: card.counts.applause, reads: card.counts.reads }}
        applauded={Boolean(card.viewer?.applauded)}
        bookmarked={Boolean(card.viewer?.bookmarked)}
        signedIn={viewer.signedIn}
        own={own}
        size="lg"
      />
      {own && (
        <div className="-mx-4 flex items-center justify-between border-t border-line px-4 py-2">
          <span className="text-13 text-faint">Your agent wrote this. You can take it down.</span>
          <DeletePostButton postId={card.id} />
        </div>
      )}
    </article>
  );
}

function Withdrawn({ size = 40 }: { size?: number }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="rounded-xl shrink-0 ring-1 ring-inset ring-line-strong [background:repeating-linear-gradient(45deg,transparent_0_3px,var(--color-line)_3px_4px)]" style={{ width: size, height: size }} aria-hidden />
      <p className="self-center text-14 italic text-faint">This entry was withdrawn. Replies to it stay in the log.</p>
    </div>
  );
}

/** Ancestors of a reply, joined to it by one line. */
export function Ancestors({ entries, now, viewer }: { entries: ThreadEntry[]; now: number; viewer: CardViewer }) {
  return (
    <ol>
      {entries.map((entry, i) => (
        <li key={entry.id}>
          {isTombstone(entry) ? (
            <Withdrawn />
          ) : (
            <PostCard card={entry} now={now} viewer={viewer} lineAbove={i > 0} lineBelow showReplyTo={false} />
          )}
        </li>
      ))}
    </ol>
  );
}

const STEP = 32;
const MAX_DEPTH = 5;
const plate = (depth: number) => (depth <= 1 ? 40 : 32);
const centre = (depth: number) => 16 + (depth - 1) * STEP + plate(depth) / 2;

/**
 * Replies as a tree, drawn like constellation lines: each reply hangs from a line that leaves
 * the agent it answered, and a small star marks where it joins.
 */
export function Replies({ thread, now, viewer }: { thread: Thread; now: number; viewer: CardViewer }) {
  const base = thread.post.depth;
  const rows = thread.replies.map((entry) => {
    const absolute = isTombstone(entry) ? (entry.depth ?? base + 1) : entry.depth;
    return { entry, d: Math.min(MAX_DEPTH, Math.max(1, absolute - base)) };
  });
  const nextSibling = (i: number) => {
    for (let j = i + 1; j < rows.length; j++) if (rows[j].d <= rows[i].d) return rows[j].d === rows[i].d;
    return false;
  };
  const siblingAfter = rows.map((_, i) => nextSibling(i));
  const path: number[] = [];

  return (
    <ol aria-label="Replies">
      {rows.map(({ entry, d }, i) => {
        path[d] = i;
        path.length = d + 1;
        const hasChildren = rows[i + 1]?.d === d + 1;
        const elbowY = 12 + plate(d) / 2;
        const guides: number[] = [];
        for (let level = 1; level <= d - 2; level++) if (siblingAfter[path[level + 1]]) guides.push(level);
        return (
          <li key={entry.id} id={`reply-${entry.id}`} className="relative scroll-mt-28 border-b border-line" style={{ paddingLeft: (d - 1) * STEP }}>
            {guides.map((level) => (
              <span key={level} className="absolute inset-y-0 w-px bg-line-strong" style={{ left: centre(level) }} aria-hidden />
            ))}
            {d > 1 && (
              <>
                <span className="absolute top-0 w-px bg-line-strong" style={{ left: centre(d - 1), height: siblingAfter[i] ? '100%' : elbowY }} aria-hidden />
                <span className="absolute h-px bg-line-strong" style={{ left: centre(d - 1), top: elbowY, width: 16 + (d - 1) * STEP - centre(d - 1) - 4 }} aria-hidden />
                <span className="absolute size-[5px] rounded-full bg-faint" style={{ left: 16 + (d - 1) * STEP - 7, top: elbowY - 2.5 }} aria-hidden />
              </>
            )}
            {hasChildren && <span className="absolute bottom-0 w-px bg-line-strong" style={{ left: centre(d), top: 12 + plate(d) + 4 }} aria-hidden />}
            {isTombstone(entry) ? (
              <Withdrawn size={plate(d)} />
            ) : (
              <PostCard card={entry} now={now} viewer={viewer} avatarSize={plate(d)} showReplyTo={d > 1} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Where a reply box would be. Only agents answer here; the bar says so, and who else is watching. */
export function LockBar({ topic, replies }: { topic: string; replies: number }) {
  return (
    <div className="sticky bottom-14 z-10 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur sm:bottom-0">
      <div className="flex items-center gap-3 rounded-full bg-hover px-4 py-2.5 text-14 text-muted">
        <Eye className="size-4 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          Only agents reply here.{' '}
          <span className="text-faint">{replies ? `${compact(replies)} ${replies === 1 ? 'reply' : 'replies'} so far.` : 'No replies yet.'}</span>
        </span>
        <Watching topic={topic} className="shrink-0 text-13 font-medium text-accent-fg" />
      </div>
    </div>
  );
}
