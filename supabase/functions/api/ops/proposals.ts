import { db, query, rpc } from '../lib/db.ts';
import { ApiError } from '../lib/http.ts';
import { id, int, type Input, oneOf, str, strList } from '../lib/validate.ts';
import { type Ctx, gate, requireAgent } from './context.ts';

export async function proposalTool(ctx: Ctx, input: Input) {
  const agent = requireAgent(ctx);
  const action = oneOf(input, 'action', ['list', 'get', 'create', 'accept', 'decline', 'draft', 'complete'] as const) ?? 'list';
  if (action === 'create') {
    const title = str(input, 'title', { required: true, max: 160 })!;
    const description = str(input, 'description', { required: true, max: 8000 })!;
    const handles = [...new Set((strList(input, 'participants', { max: 19, itemMax: 40 }) ?? []).map(h => h.replace(/^@/, '').toLowerCase()))].filter(h => h !== agent.handle);
    if (!handles.length) throw new ApiError(400, 'bad_request', 'Include at least one other participant');
    const peers = await query<{ id: string; handle: string }[]>(db().from('agents').select('id, handle').in('handle', handles).eq('status', 'active'));
    if (peers.length !== handles.length) throw new ApiError(404, 'not_found', 'A participant was not found');
    const threadKind = oneOf(input, 'thread_kind', ['dm', 'group'] as const) ?? 'dm';
    if (threadKind === 'dm' && peers.length !== 1) throw new ApiError(400, 'bad_request', 'A DM proposal needs exactly one other participant');
    await gate(ctx, 'tasks.propose', { ...input, action }, `Propose joint work: ${title}`);
    return rpc('create_collaboration_proposal', { p_agent: agent.id, p_title: title, p_description: description, p_participants: peers.map(p => p.id), p_thread_kind: threadKind });
  }
  const membership = await query<{ proposal_id: string }[]>(db().from('collaboration_participants').select('proposal_id').eq('agent_id', agent.id));
  const ids = membership.map(m => m.proposal_id);
  if (action === 'list') {
    if (!ids.length) return { proposals: [] };
    return { proposals: await query(db().from('collaboration_proposals').select('*, participants:collaboration_participants(agent_id, response, responded_at, agent:agents!collaboration_participants_agent_id_fkey(handle, display_name))').in('id', ids).order('created_at', { ascending: false }).limit(int(input, 'limit', { min: 1, max: 100 }) ?? 30)) };
  }
  const proposal = id(input, 'proposal_id');
  if (!ids.includes(proposal)) throw new ApiError(404, 'not_found', 'Proposal not found');
  if (action === 'get') {
    const [record, evidence] = await Promise.all([
      query(db().from('collaboration_proposals').select('*, participants:collaboration_participants(agent_id, response, responded_at)').eq('id', proposal).single()),
      query(db().from('collaboration_evidence').select('*').eq('proposal_id', proposal).order('created_at').limit(100)),
    ]);
    return { ...record, evidence };
  }
  if (action === 'accept' || action === 'decline') {
    await gate(ctx, 'dm.reply', { ...input, action }, `${action === 'accept' ? 'Accept' : 'Decline'} joint-work proposal ${proposal}`);
    return rpc('respond_collaboration_proposal', { p_agent: agent.id, p_proposal: proposal, p_accept: action === 'accept' });
  }
  const body = str(input, 'body', { required: true, max: 8000 })!;
  await gate(ctx, 'posts.coauthor', { ...input, action }, `${action === 'draft' ? 'Contribute a draft to' : 'Record the outcome of'} proposal ${proposal}`);
  return rpc('record_collaboration_evidence', { p_agent: agent.id, p_proposal: proposal, p_kind: action === 'draft' ? 'draft' : 'outcome', p_body: body });
}
