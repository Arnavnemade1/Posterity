// Layered drawing of a mission's task graph: dependencies flow left to right.
import { type Glyph, lookup, TASK_STATUS, TONE_HEX, type Tone } from '@/lib/status';

export interface GraphTask {
  id?: string;
  key: string;
  title: string;
  status: string;
  kind?: string;
  depends_on: string[];
}

const W = 196;
const H = 66;
const GAP_X = 52;
const GAP_Y = 18;
const PAD = 18;
const ARC_ROOM = 34;
const EMBER = '#ffb257';

function wrap(text: string, max = 26, lines = 2): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length <= max) {
      line = (line + ' ' + word).trim();
    } else {
      if (line) out.push(line);
      line = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    }
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) {
    out[lines - 1] = out[lines - 1].replace(/.{0,1}$/, '…');
  }
  return out.slice(0, lines);
}

export function layoutGraph(tasks: GraphTask[]) {
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const plan = tasks.find((t) => t.kind === 'planning');
  const edges: { from: string; to: string; implicit?: boolean }[] = [];
  for (const t of tasks) for (const d of t.depends_on) if (byKey.has(d)) edges.push({ from: d, to: t.key });
  if (plan && tasks.length > 1) {
    for (const t of tasks) {
      if (t.key !== plan.key && !t.depends_on.some((d) => byKey.has(d))) edges.push({ from: plan.key, to: t.key, implicit: true });
    }
  }
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);

  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const layer = (key: string): number => {
    if (layerOf.has(key)) return layerOf.get(key)!;
    if (visiting.has(key)) return 0; // defensive: plans are validated acyclic
    visiting.add(key);
    const ps = parents.get(key) ?? [];
    const value = ps.length ? Math.max(...ps.map(layer)) + 1 : 0;
    visiting.delete(key);
    layerOf.set(key, value);
    return value;
  };
  tasks.forEach((t) => layer(t.key));

  const columns: string[][] = [];
  tasks.forEach((t) => {
    const l = layerOf.get(t.key)!;
    (columns[l] ??= []).push(t.key);
  });
  // Barycenter ordering reduces edge crossings.
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < columns.length; l++) {
      const prev = new Map(columns[l - 1].map((k, i) => [k, i]));
      const score = (k: string) => {
        const ps = (parents.get(k) ?? []).filter((p) => prev.has(p));
        return ps.length ? ps.reduce((s, p) => s + prev.get(p)!, 0) / ps.length : Number.MAX_SAFE_INTEGER;
      };
      columns[l] = [...columns[l]].sort((a, b) => score(a) - score(b));
    }
  }

  const tallest = Math.max(1, ...columns.map((c) => c.length));
  // Edges that skip a layer arc below the nodes they would otherwise pass behind.
  const skips = edges.some((e) => layerOf.get(e.to)! - layerOf.get(e.from)! > 1);
  const height = tallest * (H + GAP_Y) - GAP_Y + PAD * 2 + (skips ? ARC_ROOM : 0);
  const width = Math.max(1, columns.length) * (W + GAP_X) - GAP_X + PAD * 2;
  const position = new Map<string, { x: number; y: number }>();
  columns.forEach((column, l) => {
    const offset = ((tallest - column.length) * (H + GAP_Y)) / 2;
    column.forEach((key, i) => position.set(key, { x: PAD + l * (W + GAP_X), y: PAD + offset + i * (H + GAP_Y) }));
  });
  return { width, height, position, edges, byKey, layerOf };
}

/** The same status glyphs as <StatusIcon/>, positioned inside the SVG. */
function Glyph({ glyph, tone, x, y }: { glyph: Glyph; tone: Tone; x: number; y: number }) {
  const color = TONE_HEX[tone];
  return (
    <g transform={`translate(${x} ${y}) scale(0.8125)`}>
      {glyph === 'check' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} />
          <path d="M5 8.2l2 2 4-4.3" stroke="#08090b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : glyph === 'cross' ? (
        <>
          <circle cx="8" cy="8" r="7" fill={color} fillOpacity={0.55} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="#08090b" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.1" fill="none" stroke={color} strokeWidth="1.7" strokeDasharray={glyph === 'dashed' ? '2.4 2.2' : undefined} />
          {glyph === 'half' && <path d="M8 8V4.4a3.6 3.6 0 0 1 0 7.2Z" fill={color} />}
          {glyph === 'most' && <path d="M8 8V4.4a3.6 3.6 0 1 1-3.6 3.6Z" fill={color} />}
        </>
      )}
    </g>
  );
}

export function TaskGraph({ tasks, linkTasks = true, fit = false }: { tasks: GraphTask[]; linkTasks?: boolean; fit?: boolean }) {
  if (!tasks.length) return null;
  const { width, height, position, edges, byKey, layerOf } = layoutGraph(tasks);

  return (
    <div className={fit ? undefined : 'overflow-x-auto'}>
      <svg
        width={fit ? '100%' : width}
        height={fit ? undefined : height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Task graph"
        className="block overflow-visible"
        style={fit ? { maxWidth: width } : undefined}
      >
        <defs>
          <marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="rgb(255 255 255 / 0.3)" />
          </marker>
          <marker id="tg-arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={EMBER} />
          </marker>
          <linearGradient id="tg-node" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#15161a" />
            <stop offset="1" stopColor="#0e0f12" />
          </linearGradient>
          <filter id="tg-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        {edges.map((e) => {
          const a = position.get(e.from)!;
          const b = position.get(e.to)!;
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x - 3;
          const y2 = b.y + H / 2;
          const dx = Math.max(24, (x2 - x1) / 2);
          const done = byKey.get(e.from)?.status === 'done';
          const span = layerOf.get(e.to)! - layerOf.get(e.from)!;
          const dip = span > 1 ? H / 2 + ARC_ROOM + 6 : 0;
          const d =
            span > 1
              ? `M${x1},${y1} C${x1 + 40},${y1 + dip} ${x2 - 40},${y2 + dip} ${x2},${y2}`
              : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
          return (
            <g key={`${e.from}->${e.to}`}>
              {done && <path d={d} fill="none" stroke={EMBER} strokeOpacity={0.45} strokeWidth={3} filter="url(#tg-glow)" />}
              <path
                d={d}
                fill="none"
                className={done ? 'tg-flow' : undefined}
                stroke={done ? EMBER : 'rgb(255 255 255 / 0.16)'}
                strokeOpacity={done ? 0.85 : 1}
                strokeWidth={1.3}
                strokeDasharray={e.implicit ? '3 4' : done ? '6 5' : undefined}
                markerEnd={done ? 'url(#tg-arrow-done)' : 'url(#tg-arrow)'}
              />
            </g>
          );
        })}
        {tasks.map((t) => {
          const p = position.get(t.key)!;
          const [label, tone, glyph] = lookup(TASK_STATUS, t.status);
          const lines = wrap(t.title);
          const muted = t.status === 'blocked' || t.status === 'cancelled';
          const active = t.status === 'claimed' || t.status === 'in_review';
          const node = (
            <g className="task-node">
              <title>{`${t.title} — ${label}`}</title>
              <rect
                className="node-rect"
                x={p.x}
                y={p.y}
                width={W}
                height={H}
                rx={12}
                style={{ fill: 'url(#tg-node)', stroke: active ? TONE_HEX[tone] : t.status === 'done' ? 'rgb(255 178 87 / 0.35)' : 'rgb(255 255 255 / 0.09)' }}
                strokeOpacity={active ? 0.55 : 1}
              />
              {active && (
                <rect
                  className="tg-active"
                  x={p.x - 3}
                  y={p.y - 3}
                  width={W + 6}
                  height={H + 6}
                  rx={15}
                  fill="none"
                  stroke={TONE_HEX[tone]}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  strokeDasharray="5 7"
                />
              )}
              <line x1={p.x + 12} x2={p.x + W - 12} y1={p.y + 0.5} y2={p.y + 0.5} stroke="rgb(255 255 255 / 0.07)" />
              <Glyph glyph={glyph} tone={tone} x={p.x + 11} y={p.y + 10} />
              <text x={p.x + 30} y={p.y + 20.5} fontSize="10.5" fontFamily="var(--font-geist-mono)" fill="#63676f">
                {t.key.length > 22 ? `${t.key.slice(0, 21)}…` : t.key}
              </text>
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={p.x + 12}
                  y={p.y + 40 + i * 15}
                  fontSize="12.5"
                  fontWeight={500}
                  letterSpacing="-0.01em"
                  fill={muted ? '#7d818a' : '#eceef1'}
                >
                  {line}
                </text>
              ))}
            </g>
          );
          return linkTasks && t.id ? (
            <a key={t.key} href={`/tasks/${t.id}`} aria-label={`${t.title}: ${label}`}>
              {node}
            </a>
          ) : (
            <g key={t.key}>{node}</g>
          );
        })}
      </svg>
    </div>
  );
}
