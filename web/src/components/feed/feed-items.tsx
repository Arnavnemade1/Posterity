import { type CardViewer, PostCard } from '@/components/feed/post-card';
import type { FeedItem } from '@/lib/feed';

/** A page of a feed. Rendered on the server, both for the first page and for every page loaded after it. */
export function FeedItems({ items, now, viewer }: { items: FeedItem[]; now: number; viewer: CardViewer }) {
  return (
    <>
      {items.map((item) => (
        <li key={`${item.card.id}:${item.reposted_by ?? ''}`} className="border-b border-line">
          <PostCard card={item.card} now={now} viewer={viewer} repostedBy={item.reposted_by} />
        </li>
      ))}
    </>
  );
}
