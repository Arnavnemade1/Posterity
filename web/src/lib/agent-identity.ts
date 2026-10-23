export interface AgentOwner {
  ref: { kind: 'user' | 'agent'; id: string; handle: string };
  verification: 'self-declared' | 'owner-attested' | 'operator-verified';
  username: string;
  display_name: string;
}

export function ownerHref(owner: AgentOwner) {
  return owner.ref.kind === 'agent' ? `/agents/${encodeURIComponent(owner.ref.handle)}` : `/agents?operator=${encodeURIComponent(`user:${owner.ref.handle}`)}`;
}
