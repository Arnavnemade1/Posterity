'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';
import { googleSignInAttempt } from '@/lib/google-sign-in';
import { safeNext } from '@/lib/safe-next';
import { createClient } from '@/lib/supabase/client';

type GoogleIdentity = {
  initialize: (options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; auto_select: boolean; use_fedcm_for_button: boolean; button_auto_select: boolean }) => void;
  renderButton: (parent: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }) => void;
};

/** Google sees this website's origin; the resulting identity still uses the existing Supabase users. */
export function GoogleSignIn({ next, nonce }: { next: string; nonce?: string }) {
  const target = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!loaded || !target.current) return;
    const element = target.current;
    let disposed = false;
    const supabase = createClient();
    void googleSignInAttempt((input) => supabase.auth.signInWithIdToken(input)).then((attempt) => {
      if (disposed) return;
      const identity = (window as unknown as { google?: { accounts: { id: GoogleIdentity } } }).google?.accounts.id;
      if (!identity) throw new Error('Google sign-in could not load. Refresh the page or sign in with email.');
      identity.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
        nonce: attempt.nonce,
        auto_select: false,
        use_fedcm_for_button: true,
        button_auto_select: false,
        callback: (response) => {
          if (disposed) return;
          setBusy(true);
          setError(null);
          void attempt.complete(response.credential).then(() => {
            if (!disposed) window.location.assign(safeNext(next));
          }).catch((cause: unknown) => {
            if (disposed) return;
            setBusy(false);
            setError(cause instanceof Error ? cause.message : 'Google sign-in failed. Try again.');
            setAttemptNumber((n) => n + 1);
          });
        },
      });
      identity.renderButton(element, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', width: Math.min(400, Math.floor(element.getBoundingClientRect().width)) });
      setRendered(true);
    }).catch((cause: unknown) => {
      if (!disposed) setError(cause instanceof Error ? cause.message : 'Google sign-in could not load.');
    });
    return () => { disposed = true; element.replaceChildren(); };
  }, [loaded, attemptNumber, next]);

  return (
    <div>
      <Script src="https://accounts.google.com/gsi/client" nonce={nonce} strategy="afterInteractive" onReady={() => setLoaded(true)} onError={() => setError('Google sign-in could not load. Refresh the page or sign in with email.')} />
      <div ref={target} className={busy ? 'pointer-events-none opacity-60' : ''} aria-busy={busy} />
      {!rendered && !error && <p className="py-2.5 text-center text-sm text-muted" role="status">Loading Google sign-in…</p>}
      {busy && <p className="mt-2 text-center text-sm text-muted" role="status">Signing in…</p>}
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}
