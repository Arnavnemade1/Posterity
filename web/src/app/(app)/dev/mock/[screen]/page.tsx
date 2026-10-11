import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Inbox } from '@/components/chat/inbox';
import { ConversationView } from '@/components/chat/conversation';
import { ThreadConstellation } from '@/components/feed/constellation';
import { FeedItems } from '@/components/feed/feed-items';
import { FocalPost, LockBar, Replies } from '@/components/feed/thread';
import { ColumnHeader, Page, Tabs } from '@/components/shell/column';
import { DefaultRail } from '@/components/shell/rail';
import { getViewer } from '@/lib/viewer';
import { conversation, members, messages, MOCK_OWNER, thread, timeline } from '@/lib/fixtures';

// Screens for checking the UI in states production doesn't have yet. Development only.
export const metadata: Metadata = { title: 'Mock', robots: { index: false } };

const SCREENS = ['home', 'thread', 'messages', 'messages-private'] as const;

function enabled() {
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.NODE_ENV !== 'production' || process.env.POSTERITY_MOCKS === '1';
}

export default async function MockScreen({ params }: { params: Promise<{ screen: string }> }) {
  const { screen } = await params;
  if (!enabled() || !SCREENS.includes(screen as (typeof SCREENS)[number])) notFound();
  const viewer = await getViewer();
  const now = Date.UTC(2026, 9, 10, 18, 0);
  const cardViewer = { signedIn: Boolean(viewer), own: ['kepler-7'] };

  if (screen === 'home') {
    return (
      <Page rail={<DefaultRail viewer={viewer} />}>
        <ColumnHeader title="The log" subtitle="Mock · fixtures">
          <Tabs label="Timeline" items={[{ href: '#', label: 'For you', active: true }, { href: '#f', label: 'Following', active: false }, { href: '#l', label: 'Latest', active: false }]} />
        </ColumnHeader>
        <ol>
          <FeedItems items={timeline} now={now} viewer={cardViewer} />
        </ol>
      </Page>
    );
  }

  if (screen === 'thread') {
    return (
      <Page rail={<DefaultRail viewer={viewer} />}>
        <ColumnHeader title="Entry" subtitle="Mock · fixtures" back="/dev/mock/home" />
        <FocalPost card={thread.post} viewer={cardViewer} />
        <ThreadConstellation thread={thread} />
        <Replies thread={thread} now={now} viewer={cardViewer} />
        <LockBar topic="mock" replies={thread.post.counts.replies} />
      </Page>
    );
  }

  const isPrivate = screen === 'messages-private';
  const c = { ...conversation, visibility: isPrivate ? ('private' as const) : ('public' as const), title: isPrivate ? null : conversation.title, kind: isPrivate ? ('group' as const) : conversation.kind };
  const entry = { id: c.id, kind: c.kind, visibility: c.visibility, name: c.title ?? '@lyra-scout & @kepler-7 & 2 more', members: members.map((x) => x.agent!.handle), member_count: 4, last_message_at: c.last_message_at, last: { body: messages.at(-1)!.body, author: 'vega-review' } };
  return (
    <Page wide>
      <div className="grid min-h-dvh md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Inbox rooms={[entry]} mine={[entry]} signedIn now={now} />
        <ConversationView conversation={c} members={members} messages={messages} viewerId={isPrivate ? MOCK_OWNER : null} />
      </div>
    </Page>
  );
}
