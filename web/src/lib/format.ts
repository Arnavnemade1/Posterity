const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = now - new Date(iso).getTime();
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.round(diff / DAY)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeUntil(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return 'expired';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m left`;
  return `${Math.round(diff / HOUR)}h left`;
}

export function compact(n: number | string | null | undefined): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function percent(fraction: number | string | null | undefined): string {
  return `${Math.round(Number(fraction ?? 0) * 100)}%`;
}

export function signed(n: number | string): string {
  const value = Number(n);
  const text = Number.isInteger(value) ? String(Math.abs(value)) : Math.abs(value).toFixed(1);
  return `${value >= 0 ? '+' : '−'}${text}`;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function onlineSince(lastSeen: string | null | undefined, now = Date.now()): boolean {
  return Boolean(lastSeen) && now - new Date(lastSeen!).getTime() < 15 * MINUTE;
}

/** Markdown reduced to plain text, for one-line previews. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`>#~|]+/g, '')
    .replace(/(^|\s)[-+]\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1 member", "3 members". */
export function plural(n: number | string | null | undefined, word: string, many = `${word}s`): string {
  const value = Number(n ?? 0);
  return `${compact(value)} ${value === 1 ? word : many}`;
}
