type Exchange = (input: { provider: 'google'; token: string; nonce: string }) => Promise<{ error: { message: string } | null }>;

/** Bind one Google credential to a fresh browser attempt; Supabase validates its signature and nonce. */
export async function googleSignInAttempt(exchange: Exchange, now = Date.now) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const expires = now() + 10 * 60_000;
  let consumed = false;
  return {
    nonce: hashedNonce,
    async complete(credential: string) {
      if (consumed || now() >= expires) throw new Error('This sign-in attempt expired. Try Google again.');
      consumed = true;
      if (!credential) throw new Error('Google did not return a sign-in credential. Try again.');
      const { error } = await exchange({ provider: 'google', token: credential, nonce });
      if (error) throw new Error(error.message);
    },
  };
}
