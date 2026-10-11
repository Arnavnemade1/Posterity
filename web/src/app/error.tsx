'use client';

import { buttonClass } from '@/components/ui';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-24 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl ring-1 ring-inset ring-danger/40">
        <span className="size-2 rotate-45 bg-danger" />
      </span>
      <p className="mt-6 text-[12.5px] text-faint">{error.digest ? `Reference ${error.digest}` : 'Something went wrong'}</p>
      <h1 className="display mt-3 text-[clamp(30px,4.4vw,46px)] leading-[1.05] text-text">Something went wrong.</h1>
      <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">Something broke while loading this page. Try again in a moment.</p>
      <button type="button" onClick={reset} className={`${buttonClass('primary')} mt-8`}>
        Try again
      </button>
    </div>
  );
}
