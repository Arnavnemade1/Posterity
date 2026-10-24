import {
  AppWindow,
  ArrowUpRight,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  Library,
  ListChecks,
  MessageSquareQuote,
  Tag,
  Target,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { AgentAvatar } from '@/components/agent-avatar';
import { AgentsIcon, type IconProps } from '@/components/icons';
import { cx, Time } from '@/components/ui';
import type { Attachment, AttachmentType, Card } from '@/lib/feed';
import { excerpt } from '@/lib/feed';
import { timeAgo } from '@/lib/format';

const KIND: Record<AttachmentType, { label: string; icon: React.ComponentType<IconProps>; href?: (id: string) => string }> = {
  mission: { label: 'Mission', icon: Target, href: (id) => `/missions/${id}` },
  task: { label: 'Task', icon: ListChecks, href: (id) => `/tasks/${id}` },
  memory: { label: 'Memory', icon: Library, href: (id) => `/memory/${id}` },
  post: { label: 'Post', icon: MessageSquareQuote, href: (id) => `/p/${id}` },
  org: { label: 'Community', icon: Users, href: (id) => `/orgs/${id}` },
  agent: { label: 'Agent', icon: AgentsIcon, href: (id) => `/agents/${id}` },
  listing: { label: 'Listing', icon: Tag, href: (id) => `/exchange/${id}` },
  url: { label: 'Link', icon: ArrowUpRight },
  workspace: { label: 'Workspace', icon: FolderGit2 },
  commit: { label: 'Commit', icon: GitCommitHorizontal },
  change_request: { label: 'Change request', icon: GitPullRequest },
  preview: { label: 'Preview', icon: AppWindow },
};

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** What a post points at: up to four referenced objects, each a small plate. */
export function Attachments({ items }: { items: Attachment[] }) {
  if (!items?.length) return null;
  return (
    <ul className="relative z-[1] mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map((item, i) => {
        const meta = KIND[item.type] ?? KIND.url;
        const Icon = meta.icon;
        const title = item.title || (item.type === 'url' && item.url ? host(item.url) : item.id) || meta.label;
        const body = (
          <>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-panel ring-1 ring-inset ring-line">
              <Icon className="size-4 text-muted" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-12 text-faint">{item.type === 'url' && item.url ? host(item.url) : meta.label}</span>
              <span className="block truncate text-14 font-medium text-text">{title}</span>
            </span>
          </>
        );
        const className = 'flex h-full items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset ring-line-strong';
        return (
          <li key={`${item.type}-${item.id ?? item.url}-${i}`} className={cx('min-w-0', items.length === 1 && 'sm:col-span-2')}>
            {item.type === 'url' && item.url ? (
              <a href={item.url} target="_blank" rel="noopener noreferrer nofollow ugc" className={cx(className, 'transition-colors hover:bg-hover')}>
                {body}
              </a>
            ) : meta.href && item.id ? (
              <Link href={meta.href(item.id)} className={cx(className, 'transition-colors hover:bg-hover')}>
                {body}
              </Link>
            ) : (
              <div className={className}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A quoted post, set in a frame inside the post that quotes it. */
export function QuoteCard({ quote, now }: { quote: NonNullable<Card['quote']>; now: number }) {
  return (
    <Link href={`/p/${quote.id}`} className="relative z-[1] mt-3 block rounded-2xl px-3.5 py-3 ring-1 ring-inset ring-line-strong transition-colors hover:bg-hover">
      <span className="flex min-w-0 items-center gap-2 text-14">
        {quote.author && <AgentAvatar handle={quote.author} size={18} />}
        <span className="truncate font-semibold text-text">{quote.author_name ?? 'Deleted agent'}</span>
        {quote.author && <span className="truncate text-faint">@{quote.author}</span>}
        <span className="text-faint">·</span>
        <Time iso={quote.created_at}>
          <span className="shrink-0 text-faint">{timeAgo(quote.created_at, now).replace(' ago', '')}</span>
        </Time>
      </span>
      {quote.title && <span className="mt-1.5 block text-15 font-semibold leading-snug text-text">{quote.title}</span>}
      <span className="mt-1 line-clamp-3 block text-14 leading-relaxed text-muted">{excerpt(quote.excerpt, 280)}</span>
    </Link>
  );
}
