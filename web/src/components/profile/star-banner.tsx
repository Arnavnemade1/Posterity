import { hash, catalogId, formatMagnitude, skyPosition } from '@/lib/sky';

/** A small seeded random generator, so every agent's patch of sky is drawn the same way every time. */
function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A profile's banner: the field of sky around the agent's own star, as a chart would plate it.
 * Graticule lines are labelled in right ascension and declination; the agent sits in the reticle.
 * At night the stars are light on dark; the day edition prints them in ink.
 */
export function StarBanner({ handle, magnitude }: { handle: string; magnitude: number }) {
  const W = 600;
  const H = 200;
  const rand = prng(hash(`${handle}#field`));
  const { ra, dec } = skyPosition(handle);
  const stars = Array.from({ length: 140 }, () => {
    const m = 6.5 - Math.pow(rand(), 2.6) * 6;
    return { x: rand() * W, y: rand() * H, r: 0.35 + (6.5 - m) * 0.22, o: 0.25 + (6.5 - m) * 0.11 };
  });
  // The reticle sits right of centre, clear of the plate that overlaps the banner's lower left.
  const cx = W * 0.68;
  const cy = H * 0.44;
  const core = 2.2 + Math.max(0, 6.5 - magnitude) * 0.5;
  const raStep = 15 / 60; // 15 minutes of right ascension per graticule column
  const raLines = [-2, -1, 0, 1, 2].map((k) => ({ x: cx + k * 120, label: ra + k * raStep }));
  const decLines = [-1, 0, 1].map((k) => ({ y: cy + k * 70, label: dec - k * 2.5 }));
  const fmtRa = (h: number) => {
    const v = ((h % 24) + 24) % 24;
    return `${pad(Math.floor(v))}h${pad(Math.floor((v % 1) * 60))}m`;
  };
  const fmtDec = (d: number) => `${d < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(d)))}°`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="block h-[150px] w-full bg-panel sm:h-[200px]" role="img" aria-label={`Sky chart around ${catalogId(handle)}`}>
      {raLines.map((l) => (
        <g key={`ra${l.x}`}>
          <line x1={l.x} x2={l.x} y1={0} y2={H} className="stroke-line" strokeWidth={1} />
          <text x={l.x + 4} y={H - 8} className="fill-faint font-mono text-11">
            {fmtRa(l.label)}
          </text>
        </g>
      ))}
      {decLines.map((l) => (
        <g key={`dec${l.y}`}>
          <line x1={0} x2={W} y1={l.y} y2={l.y} className="stroke-line" strokeWidth={1} />
          <text x={6} y={l.y - 4} className="fill-faint font-mono text-11">
            {fmtDec(l.label)}
          </text>
        </g>
      ))}
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} className="fill-text" opacity={Math.min(0.9, s.o)} />
      ))}
      <g className="text-accent">
        <circle cx={cx} cy={cy} r={22} fill="none" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
        <path d={`M${cx - 34} ${cy}h8M${cx + 26} ${cy}h8M${cx} ${cy - 34}v8M${cx} ${cy + 26}v8`} stroke="currentColor" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={core} fill="currentColor" />
        <circle cx={cx} cy={cy} r={core + 3} fill="none" stroke="currentColor" strokeOpacity={0.35} />
      </g>
      <text x={cx + 30} y={cy - 26} className="fill-muted font-mono text-11 tracking-[0.06em]">
        {catalogId(handle)}
      </text>
      <text x={cx + 30} y={cy - 13} className="fill-faint font-mono text-11 tracking-[0.06em]">
        MAG {formatMagnitude(magnitude)}
      </text>
    </svg>
  );
}
