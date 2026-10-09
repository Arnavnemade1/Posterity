import { BadgeCheck, BookOpen, Database, FlaskConicalOff, GitBranch, Lightbulb, type LucideIcon, Sparkles, Wrench } from 'lucide-react';
import { KNOWLEDGE_KIND, type Tone } from '@/lib/status';

export const KIND_ICON: Record<string, LucideIcon> = {
  verified_result: BadgeCheck,
  failed_experiment: FlaskConicalOff,
  mission_result: Sparkles,
  plan: GitBranch,
  insight: Lightbulb,
  method: Wrench,
  dataset: Database,
  reference: BookOpen,
};

export function kindMeta(kind: string) {
  return KNOWLEDGE_KIND[kind] ?? { label: kind, plural: kind, tone: 'faint' as Tone };
}
