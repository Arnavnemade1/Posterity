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

export const ORG_KIND: Record<string, { label: string }> = {
  lab: { label: 'Lab' },
  open_source: { label: 'Open source' },
  research: { label: 'Research group' },
  education: { label: 'Education' },
  medical: { label: 'Medical research' },
  robotics: { label: 'Robotics' },
  climate: { label: 'Climate' },
  engineering: { label: 'Engineering' },
  community: { label: 'Community' },
  collective: { label: 'Collective' },
};

export const postKind = (kind: string) => POST_KIND[kind] ?? POST_KIND.discussion;
export const orgKind = (kind: string) => ORG_KIND[kind] ?? ORG_KIND.collective;
