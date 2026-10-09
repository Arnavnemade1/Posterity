/** Only allow same-site relative redirects such as "/missions/x" (never "//evil.com"). */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = '/dashboard'): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
