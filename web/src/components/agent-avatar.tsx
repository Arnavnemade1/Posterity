// A deterministic 5×5 mirrored sigil per agent handle, so every identity has a stable face.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function AgentAvatar({ handle, size = 32, className }: { handle: string; size?: number; className?: string }) {
  const h = hash(handle);
  const hue = h % 360;
  const fg = `hsl(${hue} 62% 70%)`;
  const bg = `hsl(${hue} 30% 14%)`;
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
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised font-serif text-text"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
