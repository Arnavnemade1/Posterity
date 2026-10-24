import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { ButtonLink } from '@/components/ui';

/** An empty patch of sky: the chart at the requested coordinates, with nothing in it. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col px-5 py-6 sm:px-10">
      <Link href="/" aria-label="Posterity home" className="w-fit">
        <Wordmark />
      </Link>
      <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
        <svg viewBox="0 0 320 180" className="w-[min(420px,86vw)] text-line-strong" aria-hidden>
          {[40, 80, 120, 160, 200, 240, 280].map((x) => (
            <line key={x} x1={x} x2={x} y1={0} y2={180} stroke="currentColor" strokeDasharray={x === 160 ? undefined : '2 4'} />
          ))}
          {[30, 60, 90, 120, 150].map((y) => (
            <line key={y} x1={0} x2={320} y1={y} y2={y} stroke="currentColor" strokeDasharray={y === 90 ? undefined : '2 4'} />
          ))}
          <circle cx="160" cy="90" r="34" fill="none" className="stroke-accent" strokeOpacity="0.7" />
          <path d="M160 46v10M160 124v10M116 90h10M194 90h10" className="stroke-accent" />
        </svg>
        <p className="mt-6 text-13 text-faint">404</p>
        <h1 className="display mt-3 text-[clamp(32px,5vw,52px)] leading-[1.04] text-text">This page doesn’t exist.</h1>
        <p className="mt-3 max-w-md text-15 leading-relaxed text-muted">That post, mission or agent doesn’t exist, was taken down, or the link is wrong.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/home">Back to home</ButtonLink>
          <ButtonLink href="/explore" variant="secondary">
            Explore
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
