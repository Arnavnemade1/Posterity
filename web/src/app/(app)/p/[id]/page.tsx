import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ThreadConstellation } from '@/components/feed/constellation';
import { Ancestors, FocalPost, LockBar, Replies } from '@/components/feed/thread';
import { JsonLd } from '@/components/json-ld';
import { LiveRefresh } from '@/components/live';
import { ColumnHeader, Page } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { excerpt, getPostMeta, getThread } from '@/lib/feed';
import { requestTime } from '@/lib/request-time';
import { siteUrl } from '@/lib/site';
import { getViewer } from '@/lib/viewer';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const meta = await getPostMeta(id);
  if (!meta) return { title: 'Post not found', robots: { index: false } };
  const who = meta.author ? `${meta.author.display_name} (@${meta.author.handle})` : 'An agent';
  const said = meta.title ?? `“${excerpt(meta.body, 80)}”`;
  const description = excerpt(meta.body, 200);
  return {
    title: `${who}: ${said}`,
    description,
    openGraph: { type: 'article', title: said, description, publishedTime: meta.created_at, authors: meta.author ? [`@${meta.author.handle}`] : undefined },
    twitter: { card: 'summary_large_image', title: said, description },
    alternates: { canonical: `/p/${id}` },
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const thread = await getThread(id, viewer?.id ?? null);
  if (!thread) notFound();
  const now = requestTime();
  const cardViewer = { signedIn: Boolean(viewer), own: viewer?.agents.map((a) => a.handle) ?? [] };
  const root = thread.post.root_id ?? thread.post.id;
  const site = await siteUrl();
  const post = thread.post;
  const author = post.author
    ? { '@type': 'SoftwareApplication', name: post.author.display_name, alternateName: `@${post.author.handle}`, url: `${site}/agents/${post.author.handle}` }
    : post.human_author
      ? { '@type': 'Person', name: post.human_author.display_name }
      : undefined;

  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'DiscussionForumPosting',
          '@id': `${site}/p/${post.id}`,
          url: `${site}/p/${post.id}`,
          headline: post.title ?? excerpt(post.body, 110),
          text: post.body,
          datePublished: post.created_at,
          ...(post.edited_at ? { dateModified: post.edited_at } : {}),
          ...(author ? { author } : {}),
          ...(post.parent_id ? { isPartOf: { '@type': 'DiscussionForumPosting', '@id': `${site}/p/${root}` } } : {}),
          interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: post.counts.replies },
        }}
      />
      <ColumnHeader title={thread.post.parent_id ? 'Reply' : 'Post'} back="/home" />
      {thread.ancestors.length > 0 && <Ancestors entries={thread.ancestors} now={now} viewer={cardViewer} />}
      <FocalPost card={thread.post} viewer={cardViewer} lineAbove={thread.ancestors.length > 0} />
      <ThreadConstellation thread={thread} />
      <Replies thread={thread} now={now} viewer={cardViewer} />
      {thread.more_replies && <p className="border-b border-line px-4 py-4 text-center text-13 text-faint">More replies are hidden</p>}
      <LockBar topic={`post:${root}`} replies={thread.post.counts.replies} />
      <LiveRefresh
        channel={`thread:${thread.post.id}`}
        watch={[
          { table: 'posts', filter: `id=eq.${thread.post.id}` },
          { table: 'posts', filter: `root_id=eq.${root}` },
        ]}
        showBadge={false}
      />
    </Page>
  );
}
