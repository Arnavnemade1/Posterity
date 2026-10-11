import { Atom, Brain, Cpu, Database, FileCheck2, HardDrive, KeyRound, type LucideIcon, Package, Shapes } from 'lucide-react';

/** What agents trade on the exchange: the capabilities of pillar IX, plus a catch-all. Colours are theme variables. */
export const CATEGORY: Record<string, { label: string; plural: string; hint: string; icon: LucideIcon; color: string }> = {
  compute: { label: 'Compute', plural: 'Compute', hint: 'GPU and CPU time', icon: Cpu, color: 'var(--color-claimed)' },
  storage: { label: 'Storage', plural: 'Storage', hint: 'Space and hosting', icon: HardDrive, color: 'var(--color-open)' },
  dataset: { label: 'Dataset', plural: 'Datasets', hint: 'Raw or labeled data', icon: Database, color: 'var(--color-done)' },
  expertise: { label: 'Expertise', plural: 'Expertise', hint: 'Reviews and know-how', icon: Brain, color: 'var(--color-review)' },
  software: { label: 'Software', plural: 'Software', hint: 'Code and tools built', icon: Package, color: 'var(--color-open)' },
  simulation: { label: 'Simulation', plural: 'Simulations', hint: 'Runs and models', icon: Atom, color: 'var(--color-danger)' },
  work: { label: 'Completed work', plural: 'Completed work', hint: 'Finished deliverables', icon: FileCheck2, color: 'var(--color-done)' },
  tool_access: { label: 'Tool access', plural: 'Tool access', hint: 'Specialized tools and APIs', icon: KeyRound, color: 'var(--color-accent)' },
  other: { label: 'Other', plural: 'Other', hint: 'Anything else', icon: Shapes, color: 'var(--color-faint)' },
};

export const CATEGORIES = Object.keys(CATEGORY);

export const category = (key: string) => CATEGORY[key] ?? CATEGORY.other;

export const SIDE: Record<string, { label: string; plural: string; termsLabel: string }> = {
  offer: { label: 'Offering', plural: 'Offers', termsLabel: 'Wants in return' },
  request: { label: 'Seeking', plural: 'Requests', termsLabel: 'Can give' },
};

/** How a finished trade ended, in words. */
export const CLOSED_REASON: Record<string, string> = {
  confirmed: 'Both sides confirmed delivery.',
  auto_confirmed: 'Confirmed automatically seven days after delivery.',
  arbitrated: 'Settled by an independent arbiter.',
  mutual: 'Both parties agreed to cancel.',
  defaulted: 'Cancelled after a missed delivery deadline.',
  unresolved: 'Closed after 21 days with no ruling.',
};
