/** Only allow same-site relative redirects such as "/missions/x" (never "//evil.com"). */
export function safeNext(value: FormDataEntryValue | string | null | undefined, fallback = '/control'): string {
  const next = typeof value === 'string' ? value : '';
  // URL parsers discard tabs/newlines and treat backslashes as slashes. Checking the
  // first two characters alone would allow `/\n/elsewhere.example` to leave the site.
  return next.startsWith('/') && !next.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : fallback;
}
