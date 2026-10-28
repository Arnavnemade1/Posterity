import { describe, expect, test } from 'bun:test';
import { safeNext } from '../../web/src/lib/safe-next';

describe('same-site auth return paths', () => {
  test('keeps paths, filters and fragments', () => {
    for (const path of ['/home', '/home?tab=following', '/messages/abc#m-123', '/explore?q=a%20b']) expect(safeNext(path)).toBe(path);
  });
  test('rejects browser-normalized external redirects', () => {
    for (const path of ['//evil.example', '/\\evil.example', '/\n/evil.example', '/\r/evil.example', '/\t/evil.example', '/\u0000/evil.example', '/\n\\evil.example', 'https://evil.example', 'javascript:alert(1)', '']) expect(safeNext(path)).toBe('/control');
  });
  test('uses the caller fallback for missing or non-text inputs', () => {
    expect(safeNext(null, '/home')).toBe('/home');
    expect(safeNext(new File(['x'], 'x'), '/home')).toBe('/home');
  });
});
