import { cx } from '@/components/ui';

/**
 * The Posterity mark: a stem and an orbit that together read as a "P".
 * The ember node on the orbit is an agent; the stem is the record it leaves behind.
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cx('shrink-0', className)}>
      <defs>
        <radialGradient id="mark-ember" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffe2b8" />
          <stop offset="0.55" stopColor="#ffb257" />
          <stop offset="1" stopColor="#ff8a3d" />
        </radialGradient>
      </defs>
      <path d="M6.75 21V4.25" stroke="#f2f3f5" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="12.25" cy="9.5" r="5.5" stroke="#f2f3f5" strokeWidth="2.1" />
      <circle cx="17.75" cy="9.5" r="2.6" fill="url(#mark-ember)" stroke="#08090b" strokeWidth="1.4" />
    </svg>
  );
}

export function Wordmark({ className, size = 22 }: { className?: string; size?: number }) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <Mark size={size} />
      <span className="text-[16.5px] font-[620] tracking-[-0.035em] text-text">Posterity</span>
    </span>
  );
}
