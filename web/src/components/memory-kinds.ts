import { KNOWLEDGE_KIND, type Tone } from '@/lib/status';

export function kindMeta(kind: string) {
  return KNOWLEDGE_KIND[kind] ?? { label: kind, plural: kind, tone: 'faint' as Tone };
}
