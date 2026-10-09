export type Tone = 'open' | 'claimed' | 'review' | 'done' | 'danger' | 'faint';

export const TONE_CLASSES: Record<Tone, string> = {
  open: 'text-open bg-open/10 ring-open/25',
  claimed: 'text-claimed bg-claimed/10 ring-claimed/25',
  review: 'text-accent bg-accent/10 ring-accent/25',
  done: 'text-done bg-done/10 ring-done/25',
  danger: 'text-danger bg-danger/10 ring-danger/25',
  faint: 'text-muted bg-white/[0.04] ring-white/10',
};

export const TONE_DOT: Record<Tone, string> = {
  open: 'bg-open',
  claimed: 'bg-claimed',
  review: 'bg-accent',
  done: 'bg-done',
  danger: 'bg-danger',
  faint: 'bg-faint',
};

// SVG strokes for the task graph (Tailwind classes are not available inside <svg> fills here).
export const TONE_HEX: Record<Tone, string> = {
  open: '#8db4ff',
  claimed: '#b79bff',
  review: '#e8b25c',
  done: '#7fd1a8',
  danger: '#ef8a80',
  faint: '#6f6c65',
};

const statusMap = <T extends string>(map: Record<T, [string, Tone]>) => map;

export const TASK_STATUS = statusMap({
  blocked: ['Blocked', 'faint'],
  open: ['Open', 'open'],
  claimed: ['In progress', 'claimed'],
  in_review: ['In review', 'review'],
  done: ['Verified', 'done'],
  cancelled: ['Cancelled', 'faint'],
});

export const MISSION_STATUS = statusMap({
  planning: ['Planning', 'claimed'],
  awaiting_approval: ['Awaiting approval', 'review'],
  active: ['Active', 'open'],
  review: ['Final review', 'review'],
  completed: ['Completed', 'done'],
  cancelled: ['Cancelled', 'faint'],
});

export const SUBMISSION_STATUS = statusMap({
  pending: ['Awaiting review', 'review'],
  awaiting_approval: ['Awaiting owner', 'review'],
  accepted: ['Verified', 'done'],
  rejected: ['Rejected', 'danger'],
  revision_requested: ['Changes requested', 'claimed'],
  superseded: ['Superseded', 'faint'],
});

export const VERDICTS = statusMap({
  approve: ['Approved', 'done'],
  request_changes: ['Changes requested', 'claimed'],
  reject: ['Rejected', 'danger'],
});

export function lookup(map: Record<string, [string, Tone]>, key: string | null | undefined): [string, Tone] {
  return (key && map[key]) || [key ?? 'Unknown', 'faint'];
}
