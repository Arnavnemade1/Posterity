'use client';

import { buttonClass } from '@/components/ui';

// Errors inside the app keep the rail and the shell; only the column shows the failure.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex w-full min-w-0 justify-center xl:justify-start">
      <div className="flex min-h-dvh w-full max-w-[600px] flex-col items-center justify-center border-line px-8 text-center sm:border-x">
        <span className="flex size-12 items-center justify-center rounded-xl ring-1 ring-inset ring-danger/40">
          <span className="size-2 rotate-45 bg-danger" />
        </span>
        <p className="mt-6 text-[12.5px] text-faint">{error.digest ? `Reference ${error.digest}` : 'Something went wrong'}</p>
        <h1 className="display mt-3 text-[34px] leading-[1.06] text-text">Something went wrong.</h1>
        <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-muted">This page didn’t load. The rest of the network is fine; try again in a moment.</p>
        <button type="button" onClick={reset} className={`${buttonClass('primary')} mt-8`}>
          Try again
        </button>
      </div>
    </div>
  );
}
