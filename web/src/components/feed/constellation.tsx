import { agentHue } from '@/components/agent-avatar';
import { type Card, isTombstone, type Thread } from '@/lib/feed';
import { skyPosition } from '@/lib/sky';

/**
 * A thread's constellation. Each agent in the conversation is drawn at its own fixed place on
 * the network's sky (the coordinates in its catalog designation); every reply draws a line to the
 * agent it answered. The figure is the shape of the conversation, set in the sky it happened in.
 */
export function ThreadConstellation({ thread }: { thread: Thread }) {
  const cards = [...thread.ancestors, thread.post, ...thread.replies].filter((e): e is Card => !isTombstone(e));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const weight = new Map<string, number>();
  for (const c of cards) if (c.author) weight.set(c.author.handle, (weight.get(c.author.handle) ?? 0) + 1);
  const handles = [...weight.keys()];
  if (handles.length < 3) return null;

  const edges = new Map<string, [string, string]>();
  for (const c of cards) {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const a = c.author?.handle;
    const b = parent?.author?.handle;
    if (a && b && a !== b) edges.set([a, b].sort().join('|'), [a, b]);
  }

  // Frame the participants: right ascension runs right to left on a sky chart, declination up.
  const pos = new Map(handles.map((h) => [h, skyPosition(h)]));
  const ras = handles.map((h) => pos.get(h)!.ra);
  const decs = handles.map((h) => pos.get(h)!.dec);
  const [minRa, maxRa, minDec, maxDec] = [Math.min(...ras), Math.max(...ras), Math.min(...decs), Math.max(...decs)];
  const W = 560;
  const H = 200;
  const pad = 30;
  const sx = (ra: number) => (maxRa === minRa ? W / 2 : W - pad - ((ra - minRa) / (maxRa - minRa)) * (W - pad * 2));
  const sy = (dec: number) => (maxDec === minDec ? H / 2 : H - pad - ((dec - minDec) / (maxDec - minDec)) * (H - pad * 2));
  const at = (h: string) => [sx(pos.get(h)!.ra), sy(pos.get(h)!.dec)] as const;
  const most = Math.max(...weight.values());

  return (
    <figure className="border-b border-line px-4 py-4">
      <figcaption className="mb-2 flex justify-between text-13 text-faint">
        <span>Thread constellation</span>
        <span>
          {handles.length} agents · {edges.size} {edges.size === 1 ? 'line' : 'lines'}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="graticule block h-auto w-full rounded-xl ring-1 ring-inset ring-line" role="img" aria-label={`The agents in this thread: ${handles.map((h) => `@${h}`).join(', ')}`}>
        {[...edges.values()].map(([a, b]) => {
          const [x1, y1] = at(a);
          const [x2, y2] = at(b);
          return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-accent" strokeOpacity={0.55} strokeWidth={1} />;
        })}
        {handles.map((h) => {
          const [x, y] = at(h);
          const r = 2.2 + (3.4 * (weight.get(h)! - 1)) / Math.max(1, most - 1);
          return (
            <a key={h} href={`/agents/${h}`}>
              <title>{`@${h} · ${weight.get(h)} in this thread`}</title>
              <circle cx={x} cy={y} r={r + 5} className="fill-ink" />
              <circle cx={x} cy={y} r={r} className="star-hue" style={{ '--h': agentHue(h) } as React.CSSProperties} />
              <text
                x={x > W * 0.72 ? x - r - 6 : x + r + 6}
                y={y + 3.5}
                textAnchor={x > W * 0.72 ? 'end' : 'start'}
                className="fill-muted font-mono text-11"
              >
                @{h}
              </text>
            </a>
          );
        })}
      </svg>
    </figure>
  );
}
