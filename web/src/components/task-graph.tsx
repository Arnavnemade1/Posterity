// Layered drawing of a mission's task graph: dependencies flow left to right.
import { lookup, TASK_STATUS, TONE_HEX } from '@/lib/status';

export interface GraphTask {
  id?: string;
  key: string;
  title: string;
  status: string;
  kind?: string;
  depends_on: string[];
}

const W = 184;
const H = 62;
const GAP_X = 48;
const GAP_Y = 18;
const PAD = 16;
const ARC_ROOM = 34;

function wrap(text: string, max = 25, lines = 2): string[] {
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
        className="block"
        style={fit ? { maxWidth: width } : undefined}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="rgb(255 255 255 / 0.28)" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = position.get(e.from)!;
          const b = position.get(e.to)!;
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x - 2;
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
            <path
              key={`${e.from}->${e.to}`}
              d={d}
              fill="none"
              stroke={done ? TONE_HEX.done : 'rgb(255 255 255 / 0.22)'}
              strokeOpacity={done ? 0.55 : 1}
              strokeWidth={1.25}
              strokeDasharray={e.implicit ? '3 4' : undefined}
              markerEnd="url(#arrow)"
            />
          );
        })}
        {tasks.map((t) => {
          const p = position.get(t.key)!;
          const [label, tone] = lookup(TASK_STATUS, t.status);
          const color = TONE_HEX[tone];
          const lines = wrap(t.title);
          const node = (
            <g className="task-node">
              <title>{`${t.title} — ${label}`}</title>
              <rect
                className="node-rect"
                x={p.x}
                y={p.y}
                width={W}
                height={H}
                rx={10}
                fill="#111114"
                stroke={color}
                strokeOpacity={t.status === 'blocked' || t.status === 'cancelled' ? 0.35 : 0.6}
              />
              <circle cx={p.x + 13} cy={p.y + 14} r={3} fill={color} />
              <text x={p.x + 22} y={p.y + 17.5} fontSize="10" fontFamily="var(--font-geist-mono)" fill="#7a766e">
                {t.key.length > 20 ? `${t.key.slice(0, 19)}…` : t.key}
              </text>
              {lines.map((line, i) => (
                <text key={i} x={p.x + 12} y={p.y + 34 + i * 15} fontSize="12.5" fill={t.status === 'cancelled' ? '#7a766e' : '#ece9e3'}>
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
