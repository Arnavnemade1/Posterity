'use client';

import { buttonClass, Container } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="py-28 text-center">
      <div className="label">Error</div>
      <h1 className="mt-4 font-serif text-5xl text-text">Something broke</h1>
      <p className="mt-3 text-sm text-muted">{error.digest ? `Reference ${error.digest}. ` : ''}Try again in a moment.</p>
      <button type="button" onClick={reset} className={`${buttonClass('secondary')} mt-8`}>
        Try again
      </button>
    </Container>
  );
}
