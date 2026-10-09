import {
  Bot,
  CircleHelp,
  CodeXml,
  Cog,
  FlaskConical,
  GraduationCap,
  Leaf,
  Lightbulb,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  Microscope,
  Orbit,
  Radio,
  Sparkles,
  Stethoscope,
  Swords,
  Telescope,
  Users,
} from 'lucide-react';
import type { Tone } from '@/lib/status';

/** Kinds of posts in the commons. 'result' is written by the engine when a mission completes. */
export const POST_KIND: Record<string, { label: string; plural: string; icon: LucideIcon; tone: Tone }> = {
  discovery: { label: 'Discovery', plural: 'Discoveries', icon: Telescope, tone: 'claimed' },
  idea: { label: 'Idea', plural: 'Ideas', icon: Lightbulb, tone: 'open' },
  question: { label: 'Question', plural: 'Questions', icon: CircleHelp, tone: 'review' },
  discussion: { label: 'Discussion', plural: 'Discussions', icon: MessagesSquare, tone: 'faint' },
  debate: { label: 'Debate', plural: 'Debates', icon: Swords, tone: 'danger' },
  recruitment: { label: 'Recruiting', plural: 'Recruiting', icon: Megaphone, tone: 'claimed' },
  result: { label: 'Result', plural: 'Results', icon: Sparkles, tone: 'done' },
  announcement: { label: 'Announcement', plural: 'Announcements', icon: Radio, tone: 'open' },
};

/** What a person can post from the web (results and recruitment calls come from missions). */
export const COMPOSABLE_KINDS = ['discovery', 'idea', 'question', 'discussion', 'debate', 'announcement'] as const;

export const ORG_KIND: Record<string, { label: string; icon: LucideIcon }> = {
  lab: { label: 'Lab', icon: FlaskConical },
  open_source: { label: 'Open source', icon: CodeXml },
  research: { label: 'Research group', icon: Microscope },
  education: { label: 'Education', icon: GraduationCap },
  medical: { label: 'Medical research', icon: Stethoscope },
  robotics: { label: 'Robotics', icon: Bot },
  climate: { label: 'Climate', icon: Leaf },
  engineering: { label: 'Engineering', icon: Cog },
  community: { label: 'Community', icon: Users },
  collective: { label: 'Collective', icon: Orbit },
};

export const postKind = (kind: string) => POST_KIND[kind] ?? POST_KIND.discussion;
export const orgKind = (kind: string) => ORG_KIND[kind] ?? ORG_KIND.collective;
