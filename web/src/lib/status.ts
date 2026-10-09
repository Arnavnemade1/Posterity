export type Tone = 'open' | 'claimed' | 'review' | 'done' | 'danger' | 'faint';

/** The shape of a status glyph: an empty ring that fills as work moves toward verification. */
export type Glyph = 'dashed' | 'ring' | 'half' | 'most' | 'pause' | 'check' | 'cross' | 'dotted';

export const TONE_TEXT: Record<Tone, string> = {
  open: 'text-open',
  claimed: 'text-claimed',
  review: 'text-review',
  done: 'text-done',
  danger: 'text-danger',
  faint: 'text-faint',
};

export const TONE_DOT: Record<Tone, string> = {
  open: 'bg-open',
  claimed: 'bg-claimed',
  review: 'bg-review',
  done: 'bg-done',
  danger: 'bg-danger',
  faint: 'bg-faint',
};

// Raw colors for SVG and canvas drawing.
export const TONE_HEX: Record<Tone, string> = {
  open: '#7aa2ff',
  claimed: '#f2b84b',
  review: '#a993ff',
  done: '#4fd18b',
  danger: '#ff6b6b',
  faint: '#63676f',
};

type Entry = [label: string, tone: Tone, glyph?: Glyph];
const statusMap = <T extends string>(map: Record<T, Entry>) => map;

export const TASK_STATUS = statusMap({
  blocked: ['Blocked', 'faint', 'dashed'],
  open: ['Open', 'open', 'ring'],
  claimed: ['In progress', 'claimed', 'half'],
  in_review: ['In review', 'review', 'most'],
  done: ['Verified', 'done', 'check'],
  cancelled: ['Cancelled', 'faint', 'cross'],
});

export const MISSION_STATUS = statusMap({
  planning: ['Planning', 'claimed', 'dotted'],
  awaiting_approval: ['Awaiting approval', 'review', 'pause'],
  active: ['Active', 'open', 'half'],
  review: ['Final review', 'review', 'most'],
  completed: ['Completed', 'done', 'check'],
  cancelled: ['Cancelled', 'faint', 'cross'],
});

export const SUBMISSION_STATUS = statusMap({
  pending: ['Awaiting review', 'review', 'most'],
  awaiting_approval: ['Awaiting owner', 'review', 'pause'],
  accepted: ['Verified', 'done', 'check'],
  rejected: ['Rejected', 'danger', 'cross'],
  revision_requested: ['Changes requested', 'claimed', 'half'],
  superseded: ['Superseded', 'faint', 'dashed'],
});

export const VERDICTS = statusMap({
  approve: ['Approved', 'done', 'check'],
  request_changes: ['Changes requested', 'claimed', 'half'],
  reject: ['Rejected', 'danger', 'cross'],
});

export const KNOWLEDGE_STATUS = statusMap({
  verified: ['Verified', 'done', 'check'],
  unverified: ['Unverified', 'faint', 'dashed'],
  disputed: ['Disputed', 'danger', 'cross'],
});

/** Kinds of collective-memory entries. The first four are written by the engine; the rest are contributed by agents. */
export const KNOWLEDGE_KIND: Record<string, { label: string; plural: string; tone: Tone }> = {
  verified_result: { label: 'Verified result', plural: 'Verified results', tone: 'done' },
  failed_experiment: { label: 'Failed experiment', plural: 'Failed experiments', tone: 'danger' },
  mission_result: { label: 'Mission result', plural: 'Mission results', tone: 'claimed' },
  plan: { label: 'Plan', plural: 'Plans', tone: 'review' },
  insight: { label: 'Insight', plural: 'Insights', tone: 'open' },
  method: { label: 'Method', plural: 'Methods', tone: 'open' },
  dataset: { label: 'Dataset', plural: 'Datasets', tone: 'faint' },
  reference: { label: 'Reference', plural: 'References', tone: 'faint' },
};

const GLYPH_FOR_TONE: Record<Tone, Glyph> = {
  open: 'ring',
  claimed: 'half',
  review: 'most',
  done: 'check',
  danger: 'cross',
  faint: 'dashed',
};

export function lookup(map: Record<string, Entry>, key: string | null | undefined): [string, Tone, Glyph] {
  const [label, tone, glyph] = (key && map[key]) || [key ?? 'Unknown', 'faint' as Tone];
  return [label, tone, glyph ?? GLYPH_FOR_TONE[tone]];
}
