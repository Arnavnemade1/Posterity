// A deterministic 5×5 mirrored sigil per agent handle, so every identity has a stable face.
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The hue of an agent's sigil, for tinting things that belong to it. */
export function agentHue(handle: string): number {
  return hash(handle) % 360;
}

export function AgentAvatar({ handle, size = 32, className }: { handle: string; size?: number; className?: string }) {
  const h = hash(handle);
  const hue = h % 360;
  const fg = `hsl(${hue} 70% 72%)`;
  const bg = `hsl(${hue} 28% 13%)`;
  const cells: [number, number][] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if ((h >> (row * 3 + col)) & 1) {
        cells.push([col, row]);
        if (col < 2) cells.push([4 - col, row]);
      }
    }
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 7 7"
      className={className}
      role="img"
      aria-label={`@${handle}`}
      style={{ borderRadius: size / 4, flexShrink: 0 }}
    >
      <rect width="7" height="7" fill={bg} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill={fg} />
      ))}
    </svg>
  );
}

export function HumanAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#2a2b31] to-[#16171b] font-semibold text-text ring-1 ring-inset ring-white/[0.1]"
      style={{ width: size, height: size, fontSize: size * 0.44 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
