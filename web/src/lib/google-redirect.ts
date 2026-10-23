import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeNext } from './safe-next';

export const GOOGLE_ATTEMPT_PREFIX = '__Host-posterity-google-';
export const GOOGLE_ATTEMPT_SECONDS = 600;
export const googleAttemptCookieOptions = {
  httpOnly: true, secure: true, sameSite: 'none' as const, path: '/', maxAge: GOOGLE_ATTEMPT_SECONDS,
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function createGoogleRedirectAttempt(next: string, now = Date.now()) {
  const rawNonce = randomBytes(32).toString('hex');
  const nonce = digest(rawNonce);
  const target = safeNext(next);
  return {
    nonce,
    cookieName: GOOGLE_ATTEMPT_PREFIX + nonce,
    cookieValue: JSON.stringify({ rawNonce, next: encodeURIComponent(target).length <= 1024 ? target : '/control', expires: now + GOOGLE_ATTEMPT_SECONDS * 1000 }),
  };
}

/** Only selects the browser attempt. This decoded payload never authenticates a user. */
export function googleCredentialNonce(credential: string) {
  if (credential.length > 12_000 || credential.split('.').length !== 3) throw new Error('Invalid Google credential.');
  const payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64url').toString()) as { nonce?: unknown };
  if (typeof payload.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(payload.nonce)) throw new Error('Missing Google sign-in nonce.');
  return payload.nonce;
}

export function validateGoogleReturn(input: {
  credential: string; csrfCookie?: string; csrfBody?: string; attemptCookie?: string;
}, now = Date.now()) {
  if (!input.csrfCookie || !input.csrfBody || input.csrfCookie.length > 256 || !equal(input.csrfCookie, input.csrfBody)) {
    throw new Error('Google sign-in could not be verified. Please try again.');
  }
  if (!input.attemptCookie) throw new Error('Start Google sign-in again in this browser.');
  const attempt = JSON.parse(input.attemptCookie) as { rawNonce?: unknown; next?: unknown; expires?: unknown };
  if (typeof attempt.rawNonce !== 'string' || !/^[a-f0-9]{64}$/.test(attempt.rawNonce)
    || typeof attempt.expires !== 'number' || attempt.expires <= now || attempt.expires > now + GOOGLE_ATTEMPT_SECONDS * 1000
    || !equal(digest(attempt.rawNonce), googleCredentialNonce(input.credential))) {
    throw new Error('Google sign-in expired or belongs to another browser. Please try again.');
  }
  return { rawNonce: attempt.rawNonce, next: safeNext(typeof attempt.next === 'string' ? attempt.next : null) };
}

/** Bound public credential endpoints even when Content-Length is omitted. */
export async function readGoogleBody(request: Request, maxBytes = 16_384) {
  if (!request.body) throw new Error('Missing sign-in request.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new Error('Sign-in request is too large.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
