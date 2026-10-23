'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type GoogleIdentity = {
  initialize(options: { client_id: string; nonce: string; login_uri: string; ux_mode: 'redirect'; auto_select: false; use_fedcm_for_button: false }): void;
  renderButton(parent: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }): void;
};

export function GoogleRedirectSignIn({ next, nonce, fallback }: { next: string; nonce?: string; fallback: React.ReactNode }) {
  const target = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!loaded || !target.current) return;
    const element = target.current;
    const controller = new AbortController();
    void (async () => {
      const response = await fetch('/auth/google/attempt', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ next }), signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not start Google sign-in.');
      const attempt = await response.json() as { nonce: string; loginUri: string };
      if (controller.signal.aborted) return;
      const identity = (window as unknown as { google?: { accounts: { id: GoogleIdentity } } }).google?.accounts.id;
      if (!identity) throw new Error('Google sign-in could not load.');
      identity.initialize({
        client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!, nonce: attempt.nonce,
        // Google posts the credential to our website. There is no popup or JavaScript credential callback.
        ux_mode: 'redirect', login_uri: attempt.loginUri, auto_select: false, use_fedcm_for_button: false,
      });
      identity.renderButton(element, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', width: Math.min(400, Math.floor(element.getBoundingClientRect().width)) });
      setRendered(element.childElementCount > 0);
    })().catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); element.replaceChildren(); };
  }, [loaded, next]);

  return <div>
    <Script src="https://accounts.google.com/gsi/client" nonce={nonce} strategy="afterInteractive" onReady={() => setLoaded(true)} onError={() => setFailed(true)} />
    <div ref={target} />
    {rendered && !failed ? <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Trouble with Google?</summary><div className="mt-2">{fallback}</div></details> : fallback}
    {failed && <p className="mt-2 text-xs text-muted">The website sign-in could not load. The standard Google redirect is still available.</p>}
  </div>;
}
