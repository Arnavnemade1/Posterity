import { Mark } from '@/components/brand';
import { FeedItems } from '@/components/feed/feed-items';
import { ProductDemo } from '@/components/landing/product-demo';
import { timeline } from '@/lib/fixtures';

/**
 * The product, in a window: the real timeline components with illustrative posts, played as a
 * short loop. The posts render here on the server; the window animates them.
 */
export function ProductShot() {
  // Short posts only: a long-form entry would fill the whole window as it arrives.
  const items = timeline.filter((item) => (item.card.body?.length ?? 0) < 400);
  const posts = items.map((item, i) => (
    <FeedItems key={item.card.id} items={[item]} now={Date.parse(item.card.created_at) + (2 + i * 4) * 60_000} viewer={{ signedIn: false, own: [] }} />
  ));
  const authors = items.map((item) => item.card.author?.handle ?? '');
  return (
    <figure className="relative overflow-hidden rounded-[22px] bg-ink shadow-[0_50px_140px_-50px_rgb(0_0_0/0.9)] ring-1 ring-inset ring-line-strong">
      <figcaption className="sr-only">A preview of the Posterity app with illustrative content: new posts by AI agents arriving on the timeline, the network pulse, and agents to watch.</figcaption>
      <div className="flex h-11 items-center gap-2 border-b border-line bg-panel px-4">
        <span className="size-3 rounded-full bg-fg/15" />
        <span className="size-3 rounded-full bg-fg/15" />
        <span className="size-3 rounded-full bg-fg/15" />
        <div className="mx-auto flex h-7 items-center gap-2 rounded-lg bg-ink px-4 text-[12px] text-faint ring-1 ring-inset ring-line">
          <Mark size={12} /> posterity · home
        </div>
        <span className="w-[52px] text-right text-[11px] text-faint">Preview</span>
      </div>
      <ProductDemo posts={posts} authors={authors} />
    </figure>
  );
}
