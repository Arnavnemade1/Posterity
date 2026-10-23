import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createGoogleRedirectAttempt, googleCredentialNonce, readGoogleBody, validateGoogleReturn } from '../../web/src/lib/google-redirect';

const now = 1_000_000;
const token = (nonce: unknown) => `header.${Buffer.from(JSON.stringify({ nonce })).toString('base64url')}.signature`;
const returned = (attempt: ReturnType<typeof createGoogleRedirectAttempt>) => ({
  credential: token(attempt.nonce), csrfCookie: 'browser-csrf', csrfBody: 'browser-csrf', attemptCookie: attempt.cookieValue,
});

describe('Google website credential redirect browser binding', () => {
  test('only the hashed nonce leaves the server; the raw nonce is reserved for Supabase verification', () => {
    const attempt = createGoogleRedirectAttempt('/missions?status=open', now);
    const result = validateGoogleReturn(returned(attempt), now);
    expect(result.next).toBe('/missions?status=open');
    expect(createHash('sha256').update(result.rawNonce).digest('hex')).toBe(attempt.nonce);
    expect(result.rawNonce).not.toBe(attempt.nonce);
    expect(result.rawNonce).toHaveLength(64);
  });

  test('separate tabs use independent cookies and cannot exchange credentials', () => {
    const attempts = Array.from({ length: 32 }, () => createGoogleRedirectAttempt('/control', now));
    expect(new Set(attempts.map((a) => a.cookieName)).size).toBe(32);
    expect(() => validateGoogleReturn({ ...returned(attempts[0]), attemptCookie: attempts[1].cookieValue }, now)).toThrow();
  });

  test('missing, mismatched and oversized CSRF tokens fail before authentication', () => {
    const attempt = createGoogleRedirectAttempt('/control', now);
    for (const fields of [{ csrfCookie: undefined }, { csrfBody: undefined }, { csrfBody: 'attacker' }, { csrfCookie: 'a'.repeat(257), csrfBody: 'a'.repeat(257) }, { csrfBody: 'é'.repeat(12) }]) {
      expect(() => validateGoogleReturn({ ...returned(attempt), ...fields }, now)).toThrow();
    }
  });

  test('missing or consumed browser cookie and expired or malformed state fail closed', () => {
    const attempt = createGoogleRedirectAttempt('/control', now);
    expect(() => validateGoogleReturn({ ...returned(attempt), attemptCookie: undefined }, now)).toThrow();
    expect(() => validateGoogleReturn(returned(attempt), now + 600_000)).toThrow();
    expect(() => validateGoogleReturn(returned(attempt), now - 1)).toThrow();
    for (const cookie of ['bad json', '{}', 'null']) expect(() => validateGoogleReturn({ ...returned(attempt), attemptCookie: cookie }, now)).toThrow();
  });

  test('untrusted return paths never become external redirects', () => {
    for (const path of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
      const attempt = createGoogleRedirectAttempt(path, now);
      expect(validateGoogleReturn(returned(attempt), now).next).toBe('/control');
      const state = { ...JSON.parse(attempt.cookieValue), next: path };
      expect(validateGoogleReturn({ ...returned(attempt), attemptCookie: JSON.stringify(state) }, now).next).toBe('/control');
    }
  });

  test('long and heavily escaped return paths cannot overflow the browser binding cookie', () => {
    for (const path of ['/' + 'a'.repeat(4096), '/' + '🤖'.repeat(256)]) {
      const attempt = createGoogleRedirectAttempt(path, now);
      expect(encodeURIComponent(attempt.cookieValue).length).toBeLessThan(2048);
      expect(validateGoogleReturn(returned(attempt), now).next).toBe('/control');
    }
  });

  test('unverified JWT data is only accepted as a bounded nonce locator', () => {
    for (const value of ['', 'one.two', 'a.b.c', token(null), token('wrong'), 'a'.repeat(12_001)]) {
      expect(() => googleCredentialNonce(value)).toThrow();
    }
    const attempt = createGoogleRedirectAttempt('/control', now);
    expect(googleCredentialNonce(token(attempt.nonce))).toBe(attempt.nonce);
  });

  test('credential bodies are bounded even without a Content-Length header', async () => {
    expect(await readGoogleBody(new Request('https://app.example', { method: 'POST', body: 'credential=example' }))).toBe('credential=example');
    await expect(readGoogleBody(new Request('https://app.example', { method: 'POST', body: 'x'.repeat(16_385) }))).rejects.toThrow();
    await expect(readGoogleBody(new Request('https://app.example', { method: 'POST' }))).rejects.toThrow();
  });
});
