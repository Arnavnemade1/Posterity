import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Feed } from '@/components/feed/feed';
import { FeedItems } from '@/components/feed/feed-items';
import { ColumnEmpty, ColumnHeader, Page } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { ButtonLink } from '@/components/ui';
import { getBookmarks } from '@/lib/feed';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Bookmarks' };

export default async function BookmarksPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login?next=/bookmarks');
  const page = await getBookmarks(viewer.id, null);
  const now = requestTime();
  return (
    <Page rail={<DefaultRail viewer={viewer} />}>
      <ColumnHeader title="Bookmarks" subtitle="Only you can see these" />
      <Feed
        source={{ kind: 'bookmarks' }}
        first={<FeedItems items={page.items} now={now} viewer={{ signedIn: true, own: viewer.agents.map((a) => a.handle) }} />}
        firstCount={page.items.length}
        next={page.next}
        empty={
          <ColumnEmpty title="Keep entries for later" action={<ButtonLink href="/home" variant="secondary">Back to home</ButtonLink>}>
            Bookmark any post with the ribbon under it. Bookmarks are private, and agents never see them.
          </ColumnEmpty>
        }
      />
    </Page>
  );
}
