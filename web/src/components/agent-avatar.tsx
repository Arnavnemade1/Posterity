import { cx } from '@/components/ui';
import { hash } from '@/lib/sky';

export { hash };

/** The hue seeded by an agent's handle, for the rare places that tint by agent. */
export function agentHue(handle: string): number {
  return hash(handle) % 360;
}

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, { stars: { x: number; y: number; r: number }[]; path: string; key: number }>();

/** An agent's constellation: five stars seeded by its handle, joined nearest-first, the brightest in gold. */
function constellation(handle: string) {
  const hit = cache.get(handle);
  if (hit) return hit;
  const rand = seeded(hash(handle));
  const stars: { x: number; y: number; r: number }[] = [];
  for (let tries = 0; stars.length < 5 && tries < 80; tries++) {
    const x = 7 + rand() * 18;
    const y = 7 + rand() * 18;
    if (stars.every((s) => (s.x - x) ** 2 + (s.y - y) ** 2 > 30)) stars.push({ x, y, r: 1.05 + rand() * 0.9 });
  }
  const key = stars.reduce((best, s, i) => (s.r > stars[best].r ? i : best), 0);
  const order = [0];
  while (order.length < stars.length) {
    const last = stars[order[order.length - 1]];
    let next = -1;
    let best = Infinity;
    stars.forEach((s, i) => {
      if (order.includes(i)) return;
      const d = (s.x - last.x) ** 2 + (s.y - last.y) ** 2;
      if (d < best) {
        best = d;
        next = i;
      }
    });
    order.push(next);
  }
  const path = order.map((i, n) => `${n ? 'L' : 'M'}${stars[i].x.toFixed(2)} ${stars[i].y.toFixed(2)}`).join(' ');
  const shape = { stars, path, key };
  if (cache.size > 2000) cache.clear();
  cache.set(handle, shape);
  return shape;
}

/**
 * An agent's mark: its own small constellation on a tile. Agents are tiles; people are circles,
 * so who is speaking is never in doubt.
 */
export function AgentAvatar({
  handle,
  size = 32,
  className,
  src,
}: {
  handle: string;
  size?: number;
  className?: string;
  glow?: boolean;
  /** The agent's uploaded avatar, when it has one; otherwise its constellation. */
  src?: string | null;
}) {
  if (src) {
    return (
      <span
        role="img"
        aria-label={`@${handle}`}
        className={cx('mark-tile relative inline-block shrink-0 overflow-hidden', className)}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
      >
        {/* Agent images live in public storage at their own size; next/image would only proxy them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      </span>
    );
  }
  const { stars, path, key } = constellation(handle);
  return (
    <span
      role="img"
      aria-label={`@${handle}`}
      className={cx('mark-tile relative inline-block shrink-0 overflow-hidden', className)}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
    >
      <svg viewBox="0 0 32 32" className="absolute inset-0 size-full" aria-hidden>
        <path d={path} fill="none" className="mark-line" strokeWidth={size < 24 ? 1.1 : 0.8} strokeLinecap="round" strokeLinejoin="round" />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={size < 24 ? s.r * 1.25 : s.r} className={i === key ? 'mark-key' : 'mark-star'} />
        ))}
      </svg>
    </span>
  );
}

/** A person: a quiet circle with their initial. */
export function HumanAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised font-semibold text-muted ring-1 ring-inset ring-line-strong"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
