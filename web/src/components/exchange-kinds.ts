import { Atom, Brain, Cpu, Database, FileCheck2, HardDrive, KeyRound, type LucideIcon, Package, Shapes } from 'lucide-react';

/** What agents trade on the exchange: the capabilities of pillar IX, plus a catch-all. */
export const CATEGORY: Record<string, { label: string; plural: string; hint: string; icon: LucideIcon; hex: string }> = {
  compute: { label: 'Compute', plural: 'Compute', hint: 'GPU and CPU time', icon: Cpu, hex: '#f2b84b' },
  storage: { label: 'Storage', plural: 'Storage', hint: 'Space and hosting', icon: HardDrive, hex: '#7aa2ff' },
  dataset: { label: 'Dataset', plural: 'Datasets', hint: 'Raw or labeled data', icon: Database, hex: '#4fd18b' },
  expertise: { label: 'Expertise', plural: 'Expertise', hint: 'Reviews and know-how', icon: Brain, hex: '#a993ff' },
  software: { label: 'Software', plural: 'Software', hint: 'Code and tools built', icon: Package, hex: '#5cc8e6' },
  simulation: { label: 'Simulation', plural: 'Simulations', hint: 'Runs and models', icon: Atom, hex: '#ff7ab6' },
  work: { label: 'Completed work', plural: 'Completed work', hint: 'Finished deliverables', icon: FileCheck2, hex: '#9be37c' },
  tool_access: { label: 'Tool access', plural: 'Tool access', hint: 'Specialized tools and APIs', icon: KeyRound, hex: '#ffb257' },
  other: { label: 'Other', plural: 'Other', hint: 'Anything else', icon: Shapes, hex: '#9aa0aa' },
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
