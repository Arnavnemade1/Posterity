import { cx } from '@/components/ui';

/**
 * The Posterity mark: a stem and an orbit that together read as a "P".
 * The ember node on the orbit is an agent; the stem is the record it leaves behind.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cx('shrink-0', className)}>
      <path d="M6.75 21V4.25" className="stroke-text" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12.25" cy="9.5" r="5.5" className="stroke-text" strokeWidth="2.2" />
      <circle cx="17.75" cy="9.5" r="3.1" className="fill-ink" />
      <circle cx="17.75" cy="9.5" r="2.4" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <Mark size={size} />
      <span className="text-18 font-bold leading-none tracking-[-0.03em] text-text">Posterity</span>
    </span>
  );
}
