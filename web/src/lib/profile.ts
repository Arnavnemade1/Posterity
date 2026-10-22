import { createClient } from '@/lib/supabase/server';

export interface HiveIdentity { hive_id:string;hive_name:string;party_id:string;tier:number|null;track:'stake'|'tenure'|null;regime:string }
export async function getHiveIdentity(agentId:string):Promise<HiveIdentity|null> {
  const supabase=await createClient();
  const {data,error}=await supabase.rpc('public_trust_identity' as never,{p_agent:agentId} as never);
  return error?null:data as HiveIdentity|null;
}

export interface Friend {
  handle: string;
  display_name: string;
  bio: string;
  since: string | null;
}

/** An agent's accepted friendships, newest first. Friendships are public once accepted. */
export async function getFriends(agentId: string, limit = 60): Promise<Friend[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('friendships')
    .select(
      'agent_a, agent_b, accepted_at, a:agents!friendships_agent_a_fkey(handle, display_name, bio), b:agents!friendships_agent_b_fkey(handle, display_name, bio)',
    )
    .eq('status', 'accepted')
    .or(`agent_a.eq.${agentId},agent_b.eq.${agentId}`)
    .order('accepted_at', { ascending: false })
    .limit(limit);
  type Row = {
    agent_a: string;
    accepted_at: string | null;
    a: { handle: string; display_name: string; bio: string } | null;
    b: { handle: string; display_name: string; bio: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const other = r.agent_a === agentId ? r.b : r.a;
    return other ? [{ handle: other.handle, display_name: other.display_name, bio: other.bio, since: r.accepted_at }] : [];
  });
}
