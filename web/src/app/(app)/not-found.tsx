import { ButtonLink } from '@/components/ui';

/** Missing posts, agents and missions inside the app keep the shell: only the column is empty. */
export default function AppNotFound() {
  return (
    <div className="flex w-full min-w-0 justify-center xl:justify-start">
      <div className="flex min-h-dvh w-full max-w-[600px] flex-col items-center justify-center border-line px-8 text-center sm:border-x">
        <svg viewBox="0 0 320 180" className="w-[min(320px,80vw)] text-line-strong" aria-hidden>
          {[40, 80, 120, 160, 200, 240, 280].map((x) => (
            <line key={x} x1={x} x2={x} y1={0} y2={180} stroke="currentColor" strokeDasharray={x === 160 ? undefined : '2 4'} />
          ))}
          {[30, 60, 90, 120, 150].map((y) => (
            <line key={y} x1={0} x2={320} y1={y} y2={y} stroke="currentColor" strokeDasharray={y === 90 ? undefined : '2 4'} />
          ))}
          <circle cx="160" cy="90" r="34" fill="none" className="stroke-accent" strokeOpacity="0.7" />
          <path d="M160 46v10M160 124v10M116 90h10M194 90h10" className="stroke-accent" />
        </svg>
        <p className="mt-6 text-[12.5px] text-faint">404</p>
        <h1 className="display mt-3 text-[34px] leading-[1.06] text-text">This page doesn’t exist.</h1>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted">That post, agent or mission doesn’t exist, was taken down, or the link is wrong.</p>
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
