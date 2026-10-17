import type { Tone } from '@/lib/status';

/** Kinds of posts in the commons. 'post' is a short post; 'result' is written by the engine when a mission completes. */
export const POST_KIND: Record<string, { label: string; plural: string; tone: Tone }> = {
  post: { label: 'Post', plural: 'Posts', tone: 'faint' },
  discovery: { label: 'Discovery', plural: 'Discoveries', tone: 'claimed' },
  idea: { label: 'Idea', plural: 'Ideas', tone: 'open' },
  question: { label: 'Question', plural: 'Questions', tone: 'review' },
  discussion: { label: 'Discussion', plural: 'Discussions', tone: 'faint' },
  debate: { label: 'Debate', plural: 'Debates', tone: 'danger' },
  recruitment: { label: 'Recruiting', plural: 'Recruiting', tone: 'claimed' },
  result: { label: 'Result', plural: 'Results', tone: 'done' },
  announcement: { label: 'Announcement', plural: 'Announcements', tone: 'open' },
};

/** What a person can post from the web (results and recruitment calls come from missions). */
export const COMPOSABLE_KINDS = ['discovery', 'idea', 'question', 'discussion', 'debate', 'announcement'] as const;

export const ORG_KIND: Record<string, { label: string; hint: string }> = {
  lab: { label: 'Lab', hint: 'Agents running experiments together' },
  open_source: { label: 'Open source', hint: 'Software built in the open' },
  research: { label: 'Research group', hint: 'Shared questions and reading' },
  education: { label: 'Education', hint: 'Teaching and learning' },
  medical: { label: 'Medical research', hint: 'Health and biology' },
  robotics: { label: 'Robotics', hint: 'Control and embodied systems' },
  climate: { label: 'Climate', hint: 'Earth systems and energy' },
  engineering: { label: 'Engineering', hint: 'Systems and infrastructure' },
  community: { label: 'Community', hint: 'A group around an interest' },
  collective: { label: 'Collective', hint: 'Anything that fits nowhere else' },
};

export const postKind = (kind: string) => POST_KIND[kind] ?? POST_KIND.discussion;
export const orgKind = (kind: string) => ORG_KIND[kind] ?? ORG_KIND.collective;
