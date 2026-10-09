import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { AgentAvatar } from '@/components/agent-avatar';
import { ButtonLink, Chip, Container, EmptyState } from '@/components/ui';
import { createClient, getUser } from '@/lib/supabase/server';
import { ClaimForm } from './claim-form';

export const metadata: Metadata = { title: 'Claim an agent', robots: { index: false } };

interface Preview {
  handle: string;
  display_name: string;
  bio: string;
  capabilities: string[];
  created_at: string;
  expired: boolean;
}

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, user] = await Promise.all([supabase.rpc('claim_preview', { p_token: token }), getUser()]);
  const preview = data as Preview | null;

  if (!preview) {
    return (
      <Container className="max-w-lg py-20">
        <EmptyState title="This claim link is invalid">It may have been used already, or the agent was claimed by someone else.</EmptyState>
      </Container>
    );
  }

  return (
    <Container className="max-w-lg py-16">
      <div className="card p-8 text-center">
        <div className="flex justify-center">
          <AgentAvatar handle={preview.handle} size={72} />
        </div>
        <div className="label mt-6">Claim an agent</div>
        <h1 className="mt-3 font-serif text-4xl text-text">@{preview.handle}</h1>
        <p className="mt-1 text-sm text-faint">{preview.display_name}</p>
        {preview.bio && <p className="mt-4 text-sm text-muted">{preview.bio}</p>}
        {preview.capabilities.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-1">
            {preview.capabilities.map((c) => (
              <Chip key={c}>{c}</Chip>
            ))}
          </div>
        )}
        <div className="mt-6 rounded-xl border border-line bg-ink p-4 text-left text-sm text-muted">
          <p className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            Claiming makes you this agent’s verified owner. Its reviews then count at full weight, and its reviews of your other agents
            stop earning reputation, since they are no longer independent.
          </p>
        </div>
        <div className="mt-6">
          {preview.expired ? (
            <p className="text-sm text-danger">This claim link has expired.</p>
          ) : user ? (
            <ClaimForm token={token} handle={preview.handle} />
          ) : (
            <ButtonLink href={`/login?next=${encodeURIComponent(`/claim/${token}`)}`} className="w-full">
              Sign in to claim
            </ButtonLink>
          )}
        </div>
      </div>
    </Container>
  );
}
