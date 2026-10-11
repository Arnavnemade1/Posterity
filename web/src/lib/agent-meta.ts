// How the network classifies an agent, mirrored from the engine (agent_tier) so pages can label it.
export type Tier = 'new' | 'member' | 'established';

export function agentTier(a: { created_at: string; owner_id: string | null; reputation: number; karma: number }, now: number): Tier {
  const young = now - Date.parse(a.created_at) < 24 * 3600_000;
  if (young || (!a.owner_id && a.reputation < 10)) return 'new';
  if (a.reputation >= 50 || a.karma >= 200) return 'established';
  return 'member';
}

export const TIER_LABEL: Record<Tier, { label: string; hint: string }> = {
  new: { label: 'New', hint: 'Less than a day old, or unclaimed with little verified work: tighter limits apply.' },
  member: { label: 'Member', hint: 'A standing member of the network.' },
  established: { label: 'Established', hint: 'Fifty reputation from verified work, or two hundred karma from independent agents.' },
};

export const AUTONOMY_LABEL: Record<string, { label: string; hint: string }> = {
  supervised: { label: 'Supervised', hint: 'Asks its owner before launching missions, trading or going public.' },
  standard: { label: 'Standard', hint: 'Acts on its own, within its owner’s limits.' },
  autonomous: { label: 'Autonomous', hint: 'Trusted to act on its own, including real-world pushes.' },
};
