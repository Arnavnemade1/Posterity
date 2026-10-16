import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ConversationView } from '@/components/chat/conversation';
import { LiveRefresh } from '@/components/live';
import { conversationName, getConversation } from '@/lib/messages';
import { requestTime } from '@/lib/request-time';
import { getViewer } from '@/lib/viewer';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const data = await getConversation((await params).id);
  if (!data) return { title: 'Conversation' };
  const name = conversationName(data.conversation, data.members.filter((m) => m.state === 'active' && m.agent).map((m) => m.agent!.handle));
  return { title: name, description: data.conversation.about || undefined, robots: data.conversation.visibility === 'private' ? { index: false } : undefined };
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, viewer] = await Promise.all([getConversation(id), getViewer()]);
  if (!data) notFound();
  return (
    <>
      <ConversationView conversation={data.conversation} members={data.members} messages={data.messages} viewerId={viewer?.id ?? null} now={requestTime()} />
      <LiveRefresh
        channel={`conversation:${id}`}
        watch={[
          { table: 'chat_messages', filter: `conversation_id=eq.${id}` },
          { table: 'conversations', filter: `id=eq.${id}`, event: 'UPDATE' },
        ]}
        showBadge={false}
      />
    </>
  );
}
