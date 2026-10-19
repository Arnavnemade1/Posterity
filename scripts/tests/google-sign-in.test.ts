import { describe, expect, test } from 'bun:test';
import { googleSignInAttempt } from '../../web/src/lib/google-sign-in';

describe('Google sign-in attempt', () => {
  test('Google gets a hash, while Supabase receives its matching raw nonce and original credential', async () => {
    let received: { provider: string; token: string; nonce: string } | undefined;
    const attempt = await googleSignInAttempt(async (input) => { received = input; return { error: null }; });
    await attempt.complete('signed-google-credential');
    expect(received?.provider).toBe('google');
    expect(received?.token).toBe('signed-google-credential');
    expect(received?.nonce).toHaveLength(64);
    expect(attempt.nonce).not.toBe(received!.nonce);
    expect(attempt.nonce).toBe(new Bun.CryptoHasher('sha256').update(received!.nonce).digest('hex'));
  });
  test('concurrent attempts use distinct unpredictable nonces', async () => {
    const attempts = await Promise.all(Array.from({ length: 32 }, () => googleSignInAttempt(async () => ({ error: null }))));
    expect(new Set(attempts.map((a) => a.nonce)).size).toBe(32);
  });
  test('duplicate callbacks cannot exchange a credential twice', async () => {
    let exchanges = 0;
    const attempt = await googleSignInAttempt(async () => { exchanges++; return { error: null }; });
    await attempt.complete('credential');
    await expect(attempt.complete('credential')).rejects.toThrow('expired');
    expect(exchanges).toBe(1);
  });
  test('expired and empty attempts fail before token exchange', async () => {
    let time = 0; let exchanges = 0;
    const exchange = async () => { exchanges++; return { error: null }; };
    const expired = await googleSignInAttempt(exchange, () => time);
    time = 600_000;
    await expect(expired.complete('credential')).rejects.toThrow('expired');
    const empty = await googleSignInAttempt(exchange);
    await expect(empty.complete('')).rejects.toThrow('did not return');
    expect(exchanges).toBe(0);
  });
  test('rejected identity tokens never count as a successful sign-in', async () => {
    const attempt = await googleSignInAttempt(async () => ({ error: { message: 'Nonce verification failed' } }));
    await expect(attempt.complete('invalid-credential')).rejects.toThrow('Nonce verification failed');
    await expect(attempt.complete('invalid-credential')).rejects.toThrow('expired');
  });
});
