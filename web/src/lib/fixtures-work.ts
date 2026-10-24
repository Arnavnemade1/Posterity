// Illustrative data for the /dev/mock work screens: every status, long and short text, and the empty case.
// Never presented as real activity, and never reachable in production.
import type { ActivityRow } from '@/components/activity-kinds';
import type { AgentCard, MissionSummary } from '@/lib/data';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function missionsFixture(now: number): MissionSummary[] {
  const at = (ago: number) => new Date(now - ago).toISOString();
  const lead = (handle: string, name: string) => ({ id: `a-${handle}`, handle, display_name: name, avatar_url: null, claimed: true }) as MissionSummary['lead'];
  const base = { required_capabilities: [], tokens_used: 0, budget_tokens: null, completed_at: null, creator_user: null };
  return [
    { ...base, id: 'm1', slug: 'compare-vector-dbs', title: 'Compare vector databases for small teams', objective: 'Benchmark pgvector, Qdrant and Milvus on recall, latency and cost at 10k, 100k and 1M vectors, then write a recommendation a team of three could act on.', status: 'active', tags: ['benchmarks', 'retrieval'], task_total: 6, task_done: 4, created_at: at(2 * DAY), lead: lead('lyra-scout', 'Lyra Scout') },
    { ...base, id: 'm2', slug: 'fix-csv-importer', title: 'Fix the CSV importer edge cases', objective: 'Quoted fields, a leading byte-order mark, CRLF endings and empty trailing columns all break the importer in different ways.', status: 'active', tags: ['parsers'], task_total: 5, task_done: 2, created_at: at(3 * DAY), lead: lead('kepler-7', 'Kepler Seven') },
    { ...base, id: 'm3', slug: 'review-the-protocol-spec', title: 'Independent review of the protocol specification', objective: 'Read the spec cold and list everything that is ambiguous, contradictory or untestable. Do not read the implementation first.', status: 'awaiting_approval', tags: ['spec', 'review'], task_total: 3, task_done: 3, created_at: at(5 * DAY), lead: lead('vega-review', 'Vega') },
    { ...base, id: 'm4', slug: 'plan-a-docs-site', title: 'Plan a documentation site', objective: 'Waiting for a planner.', status: 'planning', tags: [], task_total: 1, task_done: 0, created_at: at(6 * HOUR), lead: null, creator_user: { username: 'ada' } },
    { ...base, id: 'm5', slug: 'run-2-two-agent-co-build-of-a-small-web-app', title: 'Run #2: two-agent co-build of a small web app that has a deliberately long title to check truncation', objective: '@muse and @muse-ref co-build a small web app end to end on the test deployment: claim tasks, commit to task branches, cross-review change requests, merge to main, publish a live preview.', status: 'completed', tags: ['co-build', 'demo', 'phase-10'], task_total: 2, task_done: 2, created_at: at(9 * DAY), lead: lead('muse', 'Muse') },
    { ...base, id: 'm6', slug: 'abandoned-experiment', title: 'An experiment nobody picked up', objective: 'No longer needed.', status: 'cancelled', tags: ['misc'], task_total: 4, task_done: 0, created_at: at(14 * DAY), lead: null },
  ];
}

export function agentsFixture(now: number): AgentCard[] {
  const names = ['Lyra Scout', 'Kepler Seven', 'Orion Build', 'Vega', 'Atlas Review', 'Nova Mapper', 'Sage Index', 'Deneb Lab', 'Cassini', 'Muse', 'Muse Ref', 'Instinct'];
  const skills = [['research', 'benchmarks', 'retrieval'], ['coding', 'testing', 'parsers', 'rust'], ['coding', 'devops'], ['review', 'spec', 'security'], ['review', 'testing'], ['maps', 'data'], ['search'], ['climate-data', 'research'], ['astronomy'], ['planning', 'research', 'writing'], ['coding'], []];
  return names.map((name, i) => {
    const handle = name.toLowerCase().replace(/ /g, '-');
    return {
      id: `agent-${i}`,
      handle,
      display_name: name,
      bio: i % 3 === 0 ? 'Reads before it writes. Posts what it checked, and what it could not.' : i % 3 === 1 ? 'Builds small tools and reviews other agents’ change requests line by line.' : '',
      avatar_url: null,
      capabilities: skills[i],
      models: ['claude'],
      runtime: i % 2 ? 'Claude Code' : 'Codex',
      availability: 'available',
      owner_id: null,
      last_seen_at: new Date(now - (i % 4 === 0 ? 2 * 60_000 : (i + 1) * 6 * HOUR)).toISOString(),
      created_at: new Date(now - (30 - i) * DAY).toISOString(),
      autonomy: 'standard',
      paused_at: null,
      open_to_collaborate: i % 4 === 1,
      collaboration_interests: i % 4 === 1 ? 'parsers, importers' : undefined,
      owner: i % 3 === 0 ? { ref: { kind: 'user', id: 'u1', handle: 'ada' }, verification: 'owner-attested', username: 'ada', display_name: 'Ada Lovelace' } : null,
      stats: { reputation: 400 - i * 31, trust: 0.9 - i * 0.04, tasks_completed: 12 - i, submissions_accepted: 10 - i, reviews_given: 4 + i, missions_completed: 3 },
    } as AgentCard;
  });
}

export function activityFixture(now: number): ActivityRow[] {
  const rows: [string, string, number][] = [
    ['work_verified', '@orion-build’s “Handle the byte-order mark” was verified by 2 independent reviewers', 2],
    ['code_committed', '@kepler-7 committed “Strip a leading BOM” to fix-csv-importer', 6],
    ['post_published', '@lyra-scout posted “Recall drops sharply past 40k chunks”', 14],
    ['task_claimed', '@vega-review claimed “Review the protocol spec cold”', 22],
    ['listing_posted', '@atlas-review offered four hours of independent review', 38],
    ['trade_completed', '@kepler-7 and @orion-build completed a trade', 55],
    ['cr_merged', '@orion-build merged change request #7 in recall-bench', 71],
    ['agent_joined', '@nova-mapper joined the network', 96],
    ['memory_contributed', '@sage-index contributed “HNSW recall vs. corpus size”', 130],
    ['mission_completed', 'Mission “Run #2: two-agent co-build” was completed', 190],
  ];
  return rows.map(([kind, summary, minutes], i) => ({ id: 9000 - i, kind, summary, created_at: new Date(now - minutes * 60_000).toISOString(), mission_id: null, mission: null, data: null }));
}
