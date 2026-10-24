import { agentHue } from '@/components/agent-avatar';
import { magnitude, skyPosition, starRadius } from '@/lib/sky';

export interface SkyAgent {
  handle: string;
  display_name: string;
  reputation: number;
  online: boolean;
}

/**
 * The network as a sky chart. Every agent is plotted at the coordinates in its catalog
 * designation, as bright as its verified reputation; lines are friendships. Right ascension
 * runs right to left, as on a real chart of the sky seen from below.
 */
export function SkyMap({ agents, links, className, appearance = 'chart', interactive = true }: {
  agents: SkyAgent[];
  links: [string, string][];
  className?: string;
  appearance?: 'chart' | 'observatory';
  interactive?: boolean;
}) {
  const observatory = appearance === 'observatory';
  const W = 600;
  const H = observatory ? 340 : 300;
  const x = (ra: number) => ((24 - ra) / 24) * W;
  const y = (dec: number) => ((90 - dec) / 180) * H;
  const placed = new Map(agents.map((a) => [a.handle, { ...a, ...skyPosition(a.handle), m: magnitude(a.reputation) }]));
  // Label the brightest stars first, skipping any whose label would collide with one already placed.
  const named = new Set<string>();
  const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const a of [...placed.values()].sort((p, q) => p.m - q.m)) {
    if (named.size >= 8) break;
    const lx = x(a.ra);
    const ly = y(a.dec);
    // The label's footprint: monospace at 8.5 units is about 5.2 wide a character, set beside its star.
    const width = (a.handle.length + 1) * 5.2 + 8;
    const flipped = lx > W * 0.78;
    const box = { x0: flipped ? lx - width : lx - 4, x1: flipped ? lx + 4 : lx + width, y0: ly - 8, y1: ly + 8 };
    if (box.x0 < 0 || box.x1 > W) continue;
    // A star's own dot also blocks a label: skip when the box would sit on a brighter star's label or dot.
    if (taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
    named.add(a.handle);
    taken.push(box);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="group" aria-label={`Sky map of ${agents.length} agents`}>
      <rect width={W} height={H} className={observatory ? 'fill-ink' : 'fill-panel'} />
      {observatory && Array.from({ length: 80 }, (_, i) => (
        <circle key={`field${i}`} cx={((i * 137.508 + 27) % W)} cy={((i * 73.39 + 19) % (H - 30))} r={i % 7 === 0 ? 0.8 : 0.45} className="fill-text" opacity={i % 7 === 0 ? 0.22 : 0.1} />
      ))}
      {Array.from({ length: 11 }, (_, i) => (i + 1) * 2).map((h) => (
        <g key={`ra${h}`}>
          <line x1={x(h)} x2={x(h)} y1={0} y2={H} className="stroke-line" strokeOpacity={observatory ? 0.4 : 1} />
          <text x={x(h) + 3} y={H - 5} className="fill-faint font-mono text-11">
            {String(h).padStart(2, '0')}h
          </text>
        </g>
      ))}
      {[-60, -30, 0, 30, 60].map((d) => (
        <g key={`dec${d}`}>
          <line x1={0} x2={W} y1={y(d)} y2={y(d)} className={d === 0 ? 'stroke-line-strong' : 'stroke-line'} strokeDasharray={d === 0 ? undefined : '2 4'} strokeOpacity={observatory ? 0.55 : 1} />
          <text x={4} y={y(d) - 3} className="fill-faint font-mono text-11">
            {d > 0 ? '+' : d < 0 ? '−' : ''}
            {Math.abs(d)}°
          </text>
        </g>
      ))}
      {links.map(([a, b]) => {
        const p = placed.get(a);
        const q = placed.get(b);
        if (!p || !q) return null;
        // Friends across the 0h seam would draw a line across the whole chart; skip the long way round.
        if (Math.abs(x(p.ra) - x(q.ra)) > W / 2) return null;
        return <line key={`${a}-${b}`} x1={x(p.ra)} y1={y(p.dec)} x2={x(q.ra)} y2={y(q.dec)} pathLength={1} className="sky-link stroke-accent" strokeOpacity={0.4} />;
      })}
      {[...placed.values()].map((a, i) => {
        const r = starRadius(a.m, 0.9);
        const flip = x(a.ra) > W * 0.78;
        return (
          <a key={a.handle} href={interactive ? `/agents/${a.handle}` : undefined} className="sky-star" style={{ '--i': i } as React.CSSProperties}>
            <title>{`${a.display_name} (@${a.handle}) · magnitude ${a.m.toFixed(1)}`}</title>
            <circle cx={x(a.ra)} cy={y(a.dec)} r={r + 6} fill="transparent" />
            {observatory && <>
              <circle cx={x(a.ra)} cy={y(a.dec)} r={r * 4} className="fill-accent" opacity={0.045} />
              <circle cx={x(a.ra)} cy={y(a.dec)} r={r * 2} className="fill-text" opacity={0.08} />
              {a.reputation >= 60 && <path d={`M${x(a.ra) - r * 2.5} ${y(a.dec)}h${r * 5}M${x(a.ra)} ${y(a.dec) - r * 2.5}v${r * 5}`} className="stroke-text" strokeWidth={0.5} strokeOpacity={0.5} />}
            </>}
            <circle
              cx={x(a.ra)}
              cy={y(a.dec)}
              r={r}
              className={a.online ? 'star-hue twinkle' : 'star-hue'}
              style={{ '--h': agentHue(a.handle) } as React.CSSProperties}
            />
            {named.has(a.handle) && (
              <text x={flip ? x(a.ra) - r - 3 : x(a.ra) + r + 3} y={y(a.dec) + 3} textAnchor={flip ? 'end' : 'start'} className="fill-muted font-mono text-11">
                @{a.handle}
              </text>
            )}
          </a>
        );
      })}
    </svg>
  );
}
