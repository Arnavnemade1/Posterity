// Layered drawing of a mission's task graph: dependencies flow left to right.
import Link from 'next/link';
import { GraphViewport } from '@/components/task-graph-viewport';
import { type Glyph, lookup, TASK_STATUS, TONE_VAR, type Tone } from '@/lib/status';

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
  const color = TONE_VAR[tone];
  return (
    <g transform={`translate(${x} ${y}) scale(0.8125)`}>
      {glyph === 'check' ? (
        <>
          <circle cx="8" cy="8" r="7" style={{ fill: color }} />
          <path d="M5 8.2l2 2 4-4.3" className="stroke-ink" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : glyph === 'cross' ? (
        <>
          <circle cx="8" cy="8" r="7" style={{ fill: color }} fillOpacity={0.55} />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" className="stroke-ink" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.1" fill="none" style={{ stroke: color }} strokeWidth="1.7" strokeDasharray={glyph === 'dashed' ? '2.4 2.2' : undefined} />
          {glyph === 'half' && <path d="M8 8V4.4a3.6 3.6 0 0 1 0 7.2Z" style={{ fill: color }} />}
          {glyph === 'most' && <path d="M8 8V4.4a3.6 3.6 0 1 1-3.6 3.6Z" style={{ fill: color }} />}
        </>
      )}
    </g>
  );
}

/**
 * `interactive` puts the drawing in a window you can drag and zoom, opened fitted; without it the drawing is
 * at its own size and scrolls sideways (for small plans in a form).
 */
export function TaskGraph({ tasks, linkTasks = true, interactive = false }: { tasks: GraphTask[]; linkTasks?: boolean; interactive?: boolean }) {
  if (!tasks.length) return null;
  const { width, height, position, edges, byKey, layerOf } = layoutGraph(tasks);

  const drawing = (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Task graph"
        className="block overflow-visible"
      >
        <defs>
          <marker id="tg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="fill-faint" />
          </marker>
          <marker id="tg-arrow-done" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="fill-done" />
          </marker>
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
              <path
                d={d}
                fill="none"
                className={done ? 'tg-flow stroke-done' : 'stroke-line-strong'}
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
                style={{ fill: 'var(--color-panel)', stroke: active ? TONE_VAR[tone] : t.status === 'done' ? 'var(--color-done)' : 'var(--color-line-strong)' }}
                strokeOpacity={active ? 0.7 : t.status === 'done' ? 0.5 : 1}
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
                  style={{ stroke: TONE_VAR[tone] }}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                  strokeDasharray="5 7"
                />
              )}
              <Glyph glyph={glyph} tone={tone} x={p.x + 11} y={p.y + 10} />
              <text x={p.x + 30} y={p.y + 20.5} fontSize="10.5" className="fill-faint font-mono">
                {t.key.length > 22 ? `${t.key.slice(0, 21)}…` : t.key}
              </text>
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={p.x + 12}
                  y={p.y + 40 + i * 15}
                  fontSize="12.5"
                  fontWeight={500}
                  className={muted ? 'fill-faint' : 'fill-text'}
                >
                  {line}
                </text>
              ))}
            </g>
          );
          return linkTasks && t.id ? (
            <Link key={t.key} href={`/tasks/${t.id}`} transitionTypes={['nav-forward']} aria-label={`${t.title}: ${label}`}>
              {node}
            </Link>
          ) : (
            <g key={t.key}>{node}</g>
          );
        })}
      </svg>
  );
  if (interactive) return <GraphViewport width={width} height={height}>{drawing}</GraphViewport>;
  return <div className="overflow-x-auto">{drawing}</div>;
}
