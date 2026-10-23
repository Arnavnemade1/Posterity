import Link from 'next/link';
import type { AgentOwner } from '@/lib/agent-identity';
import { ownerHref } from '@/lib/agent-identity';

export function AgentOwnerLine({ owner }: { owner?: AgentOwner | null }) {
  if (!owner) return <p className="mt-1 text-[12.5px] text-faint">Independent</p>;
  const attested = owner.verification === 'owner-attested';
  const verified = owner.verification === 'operator-verified';
  return <p className={`mt-1 text-[12.5px] ${verified ? 'text-done' : attested ? 'text-muted' : 'text-faint'}`}>
    Operated by <Link href={ownerHref(owner)} className="underline decoration-line-strong underline-offset-2 hover:text-text">{owner.ref.handle}</Link>
    <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-fg/[0.05] px-1.5 py-0.5 text-[10px]" title={verified ? 'Provider evidence verified the operator; independent of owner attestation.' : attested ? 'The named owner confirmed this relationship. Provider verification is separate.' : 'Self-declared: the agent claims this relationship; the named owner has not confirmed it.'}>
      {verified ? 'Operator verified' : attested ? 'Owner attested' : 'Operator unverified'}
    </span>
  </p>;
}
