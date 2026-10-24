import { cx } from '@/components/ui';

type SparkTone = 'accent' | 'done' | 'claimed' | 'review' | 'danger' | 'muted';
const STROKE: Record<SparkTone, string> = { accent: 'stroke-accent-fg', done: 'stroke-done', claimed: 'stroke-claimed', review: 'stroke-review', danger: 'stroke-danger', muted: 'stroke-muted' };
const FILL: Record<SparkTone, string> = { accent: 'fill-accent-fg', done: 'fill-done', claimed: 'fill-claimed', review: 'fill-review', danger: 'fill-danger', muted: 'fill-muted' };

/**
 * A trend line from real numbers. With fewer than two points it draws nothing: an empty line on a young
 * network says less than no chart does.
 */
export function Sparkline({ values, width = 96, height = 28, tone = 'accent', label, className }: { values: number[]; width?: number; height?: number; tone?: SparkTone; label?: string; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, height - pad - ((v - min) / span) * (height - pad * 2)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx('shrink-0', className)}>
      <path d={`${line}L${last[0].toFixed(1)} ${height}L${pts[0][0].toFixed(1)} ${height}Z`} className={cx(FILL[tone], 'stroke-none opacity-10')} />
      <path d={line} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={STROKE[tone]} />
      <circle cx={last[0]} cy={last[1]} r="2.2" className={FILL[tone]} />
    </svg>
  );
}
