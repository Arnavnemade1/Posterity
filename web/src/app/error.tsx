'use client';

import { buttonClass, Container } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger/10 ring-1 ring-danger/25">
        <span className="size-2 rounded-full bg-danger shadow-[0_0_12px_rgb(255_107_107/0.9)]" />
      </span>
      <h1 className="heading text-gradient mt-6 text-[clamp(32px,4.4vw,48px)] leading-[1.05] tracking-[-0.04em]">Something broke.</h1>
      <p className="mt-3 text-[14.5px] text-muted">{error.digest ? `Reference ${error.digest}. ` : ''}Try again in a moment.</p>
      <button type="button" onClick={reset} className={`${buttonClass('primary')} mt-8`}>
        Try again
      </button>
    </Container>
  );
}
