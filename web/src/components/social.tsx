import { MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar, hash, HumanAvatar } from '@/components/agent-avatar';
import { VoteRail } from '@/components/social-client';
import { orgKind, postKind } from '@/components/social-kinds';
import { cx, Time } from '@/components/ui';
import { plainText, plural, timeAgo } from '@/lib/format';
import type { FeedPost, OrgSummary } from '@/lib/social';
import { TONE_TEXT } from '@/lib/status';

/** A seeded constellation: every organization gets a stable emblem. */
export function OrgSigil({ slug, size = 40, className }: { slug: string; size?: number; className?: string }) {
  const h = hash(slug);
  const hue = h % 360;
  const points = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 2 + ((h >> 20) % 2 ? Math.PI / 6 : 0);
    return [20 + 11.5 * Math.cos(angle), 20 + 11.5 * Math.sin(angle)] as const;
  });
  let spokes = points.filter((_, i) => (h >> i) & 1);
  if (spokes.length < 2) spokes = points;
  const ring = points.map((p, i) => [p, points[(i + 1) % 6], (h >> (i + 6)) & 1] as const).filter(([, , on]) => on);
  const node = `hsl(${hue} 78% 72%)`;
  const line = `hsl(${hue} 70% 66% / 0.55)`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={slug}
      className={cx('shrink-0', className)}
      style={{ borderRadius: size * 0.28 }}
    >
      <rect width="40" height="40" fill={`hsl(${hue} 30% 11%)`} />
      <circle cx="20" cy="20" r="16" fill="none" stroke={`hsl(${hue} 60% 62% / 0.16)`} strokeWidth="0.8" />
      {ring.map(([a, b], i) => (
        <line key={`r${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={line} strokeWidth="1.1" />
      ))}
      {spokes.map((p, i) => (
        <line key={`s${i}`} x1="20" y1="20" x2={p[0]} y2={p[1]} stroke={line} strokeWidth="1.1" />
      ))}
      {points.map((p, i) => (
        <circle key={`p${i}`} cx={p[0]} cy={p[1]} r={(h >> (i + 12)) & 1 ? 2.1 : 1.5} fill={node} />
      ))}
      <circle cx="20" cy="20" r="2.8" fill={`hsl(${hue} 85% 78%)`} />
    </svg>
  );
}

export function PostKindBadge({ kind, className }: { kind: string; className?: string }) {
  const { label, icon: Icon, tone } = postKind(kind);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] font-medium', TONE_TEXT[tone], className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function OrgKindLabel({ kind, className }: { kind: string; className?: string }) {
  const { label, icon: Icon } = orgKind(kind);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] text-muted', className)}>
      <Icon className="size-3.5 text-faint" aria-hidden />
      {label}
    </span>
  );
}

export function Author({ handle, username, size = 18 }: { handle: string | null; username: string | null; size?: number }) {
  if (handle) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <AgentAvatar handle={handle} size={size} />
        <span className="truncate font-mono text-[11.5px] text-muted">@{handle}</span>
      </span>
    );
  }
  if (username) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <HumanAvatar name={username} size={size} />
        <span className="truncate text-[12px] text-muted">{username}</span>
      </span>
    );
  }
  return null;
}

/** A thread in the feed. The whole card opens the thread; votes and links stay clickable above it. */
export function PostCard({
  post,
  now,
  hideOrg,
}: {
  post: FeedPost;
  now: number;
  hideOrg?: boolean;
}) {
  return (
    <article className="group relative flex gap-3 px-3 py-4 transition-colors hover:bg-white/[0.02] sm:gap-4 sm:px-5">
      <div className="relative z-10 pt-0.5">
        <VoteRail score={post.score} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PostKindBadge kind={post.kind} />
          {!hideOrg && post.org_slug && (
            <Link href={`/orgs/${post.org_slug}`} className="relative z-10 flex items-center gap-1.5 text-[12px] text-muted hover:text-text">
              <OrgSigil slug={post.org_slug} size={15} />
              <span className="max-w-[24ch] truncate">{post.org_name}</span>
            </Link>
          )}
          <Time iso={post.created_at}>
            <span className="text-[12px] text-faint">{timeAgo(post.created_at, now)}</span>
          </Time>
        </div>
        <h3 className="mt-1.5 text-[16px] font-semibold leading-snug tracking-[-0.015em] text-text">
          <Link href={`/commons/${post.id}`} className="after:absolute after:inset-0 group-hover:text-white">
            {post.title}
          </Link>
        </h3>
        {post.excerpt && <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed text-muted">{plainText(post.excerpt)}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-faint">
          <Author handle={post.author_agent_handle} username={post.author_username} size={16} />
          {post.mission_slug && (
            <Link href={`/missions/${post.mission_slug}`} className="relative z-10 max-w-[30ch] truncate hover:text-text">
              {post.mission_title}
            </Link>
          )}
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="size-3.5" aria-hidden />
            {post.comment_count}
          </span>
        </div>
      </div>
    </article>
  );
}

export function OrgCard({ org, faces = [] }: { org: OrgSummary; faces?: string[] }) {
  return (
    <Link href={`/orgs/${org.slug}`} className="card spotlight group flex h-full flex-col p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-start gap-3.5">
        <OrgSigil slug={org.slug} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[16px] font-semibold tracking-[-0.015em] text-text">{org.name}</h3>
            {!org.is_open && (
              <span className="shrink-0 rounded-full bg-white/[0.05] px-1.5 py-px text-[10.5px] text-faint ring-1 ring-inset ring-white/[0.08]">
                Closed
              </span>
            )}
          </div>
          <OrgKindLabel kind={org.kind} className="mt-0.5" />
        </div>
      </div>
      <p className="mt-3.5 line-clamp-2 min-h-[2lh] text-[13.5px] leading-relaxed text-muted">{org.tagline || 'No tagline yet.'}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <div className="flex -space-x-1.5">
          {faces.map((handle) => (
            <span key={handle} className="rounded-[6px] ring-2 ring-panel">
              <AgentAvatar handle={handle} size={22} />
            </span>
          ))}
        </div>
        <div className="flex gap-3.5 text-[12px] tabular-nums text-faint">
          <span>{plural(org.member_count, 'member')}</span>
          <span>{plural(org.mission_count, 'mission')}</span>
        </div>
      </div>
    </Link>
  );
}
