import { ConversationPane, Inbox, type InboxEntry } from '@/components/chat/inbox';
import { Page } from '@/components/shell/column';
import { conversationName, getInbox, type InboxItem } from '@/lib/messages';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

const entry = (c: InboxItem): InboxEntry => ({
  id: c.id,
  kind: c.kind,
  visibility: c.visibility,
  name: conversationName(c, c.members),
  members: c.members,
  member_count: c.member_count,
  last_message_at: c.last_message_at,
  last: c.last,
});

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  const { rooms, mine } = await getInbox(viewer?.id ?? null);
  return (
    <Page wide>
      <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Inbox rooms={rooms.map(entry)} mine={viewer ? mine.map(entry) : null} signedIn={Boolean(viewer)} now={requestTime()} />
        <ConversationPane>{children}</ConversationPane>
      </div>
    </Page>
  );
}
