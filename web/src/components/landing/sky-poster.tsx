import { cx } from '@/components/ui';

// A fixed handful of stars and one small constellation: x, y (percent), radius, brightness.
const STARS: [number, number, number, number][] = [
  [8, 14, 1.1, 0.5], [14, 62, 0.9, 0.35], [21, 28, 1.4, 0.7], [27, 80, 0.8, 0.3], [33, 9, 1, 0.45], [38, 46, 1.2, 0.6], [44, 72, 0.9, 0.35],
  [49, 21, 1.6, 0.8], [53, 58, 0.9, 0.4], [58, 88, 1, 0.35], [62, 34, 1.3, 0.65], [67, 12, 0.9, 0.4], [71, 67, 1.1, 0.5], [76, 42, 1.8, 0.9],
  [81, 24, 1, 0.45], [84, 78, 1.2, 0.55], [88, 52, 0.9, 0.4], [92, 17, 1.4, 0.7], [95, 70, 0.8, 0.3], [5, 86, 0.8, 0.3], [18, 44, 0.8, 0.3],
  [41, 92, 0.8, 0.3], [73, 90, 0.8, 0.3], [56, 6, 0.9, 0.4], [91, 38, 0.8, 0.35],
];
// The little constellation: a few joined stars, with the brightest in gold.
const CONSTELLATION: [number, number][] = [[68, 36], [75, 43], [82, 33], [89, 40], [84, 53]];

/**
 * The sky before the WebGL sky arrives (and instead of it when it never will: reduced data, no WebGL, a still
 * page): drawn in SVG, so it costs nothing and is there in the first paint.
 */
export function SkyPoster({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={cx('absolute inset-0 size-full', className)}>
      <defs>
        <radialGradient id="sky-glow" cx="62%" cy="48%" r="46%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill="url(#sky-glow)" />
      <polyline points={CONSTELLATION.map(([x, y]) => `${x},${y}`).join(' ')} stroke="#ffffff" strokeOpacity="0.2" strokeWidth="0.14" fill="none" />
      {CONSTELLATION.map(([x, y], i) => (
        <circle key={`c${i}`} cx={x} cy={y} r={i === 1 ? 0.55 : 0.32} fill={i === 1 ? '#e2a94b' : '#ffffff'} fillOpacity={i === 1 ? 1 : 0.8} />
      ))}
      {STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x} cy={y} r={r * 0.22} fill="#ffffff" fillOpacity={o} />
      ))}
    </svg>
  );
}
