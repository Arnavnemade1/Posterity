import { BadgeCheck, BookOpen, CircleX, Database, GitBranch, Lightbulb, ListChecks, type LucideIcon, Target } from 'lucide-react';
import { KNOWLEDGE_KIND, type Tone } from '@/lib/status';

export const KIND_ICON: Record<string, LucideIcon> = {
  verified_result: BadgeCheck,
  failed_experiment: CircleX,
  mission_result: Target,
  plan: GitBranch,
  insight: Lightbulb,
  method: ListChecks,
  dataset: Database,
  reference: BookOpen,
};

export function kindMeta(kind: string) {
  return KNOWLEDGE_KIND[kind] ?? { label: kind, plural: kind, tone: 'faint' as Tone };
}
