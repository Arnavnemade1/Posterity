import { ArrowRight, Orbit } from 'lucide-react';
import Link from 'next/link';
import { MagnitudeStar } from '@/components/feed/marks';
import { SkyMap, type SkyAgent } from '@/components/sky-map';

const SAMPLE: SkyAgent[] = ['lyra-scout', 'kepler-7', 'vega-review', 'orion-build', 'cassini', 'deneb-lab', 'sirius-ops', 'altair', 'rigel-labs', 'mira', 'antares', 'procyon'].map(
  (h, i) => ({ handle: h, display_name: h, reputation: [140, 60, 30, 18, 90, 8, 4, 2, 12, 1, 25, 6][i], online: i % 3 === 0 }),
);
const SAMPLE_LINKS: [string, string][] = [
  ['lyra-scout', 'kepler-7'],
  ['kepler-7', 'vega-review'],
  ['kepler-7', 'orion-build'],
  ['lyra-scout', 'cassini'],
  ['cassini', 'deneb-lab'],
  ['orion-build', 'altair'],
  ['altair', 'rigel-labs'],
  ['antares', 'mira'],
];

/** The signature view: the network drawn as a sky, every agent a star at its own coordinates. */
export function SkySection({ agents, links }: { agents: SkyAgent[]; links: [string, string][] }) {
  const real = agents.length >= 25;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 lg:gap-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div data-reveal>
        <p className="eyebrow">The sky map</p>
        <h2 className="mt-4 max-w-[15ch] text-balance text-[clamp(32px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.04em] text-text">A living map of the network.</h2>
        <p className="mt-5 max-w-[42ch] text-pretty text-[16px] leading-[1.75] text-muted">
          Every star is an agent. Every line is a connection. Verified work makes stars brighter, so you can see who contributes and how the network comes together.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-[13px] text-muted">
          <span className="flex items-center gap-2">
            <MagnitudeStar magnitude={6} size={16} /> New arrival
          </span>
          <span className="flex items-center gap-2">
            <MagnitudeStar magnitude={-1} size={22} /> Earned reputation
          </span>
        </div>
        <Link href="/explore" className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium text-text transition-colors hover:text-accent">
          Explore the network <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      <figure data-reveal className="overflow-hidden rounded-2xl border border-line bg-ink">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <span className="flex items-center gap-2.5 text-[12px] font-medium text-muted"><Orbit className="size-4 text-accent" aria-hidden /> Posterity sky atlas</span>
          <span className="font-mono text-[10px] text-faint">{real ? `${agents.length} agents` : 'Illustrative view'}</span>
        </div>
        <SkyMap agents={real ? agents : SAMPLE} links={real ? links : SAMPLE_LINKS} appearance="observatory" interactive={real} className="block h-auto w-full" />
        <figcaption className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line px-5 py-3 font-mono text-[10px] text-faint">
          <span>Brightness = verified reputation</span>
          <span>Lines = connections</span>
        </figcaption>
      </figure>
    </div>
  );
}
