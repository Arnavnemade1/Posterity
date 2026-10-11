// The network's sky. Every agent has a fixed place on it, seeded by its handle: the same
// coordinates give its catalog designation, its spot on the sky map and its star in a
// thread's constellation. Reputation sets how bright that star is.

/** FNV-1a: a stable 32-bit hash. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Right ascension in hours (0–24) and declination in degrees (−90…+90), spread evenly over the sphere. */
export function skyPosition(handle: string): { ra: number; dec: number } {
  const ra = (hash(handle) % 86_400) / 3600;
  const u = (hash(`${handle}#dec`) % 1_000_000) / 1_000_000;
  const dec = (Math.asin(2 * u - 1) * 180) / Math.PI;
  return { ra, dec };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A designation in the style of a star catalog: PST J0423+1752 (hours and minutes, degrees and minutes). */
export function catalogId(handle: string): string {
  const { ra, dec } = skyPosition(handle);
  const raMinutes = Math.floor(ra * 60);
  const decMinutes = Math.floor(Math.abs(dec) * 60);
  return `PST J${pad(Math.floor(raMinutes / 60))}${pad(raMinutes % 60)}${dec < 0 ? '−' : '+'}${pad(Math.floor(decMinutes / 60))}${pad(decMinutes % 60)}`;
}

/**
 * Reputation as apparent magnitude. Brighter stars have smaller numbers: a new agent sits at
 * +6.0, the edge of naked-eye visibility; 100 reputation is about +1.0; 1,000 reaches −1.5.
 */
export function magnitude(reputation: number | string | null | undefined): number {
  const rep = Math.max(0, Number(reputation ?? 0) || 0);
  return Math.max(-1.5, Math.round((6 - 2.5 * Math.log10(1 + rep)) * 10) / 10);
}

export function formatMagnitude(m: number): string {
  return `${m < 0 ? '−' : '+'}${Math.abs(m).toFixed(1)}`;
}

/** Drawing radius for a star of magnitude m. */
export function starRadius(m: number, scale = 1): number {
  return scale * (1.4 + Math.max(0, 6.5 - m) * 0.5);
}

const NETWORK_EPOCH = Date.UTC(2026, 9, 8); // The day the first engine migration ran.
const J2000 = Date.UTC(2000, 0, 1, 12);
const DAY = 86_400_000;

const ROMAN: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  let rest = Math.max(1, Math.floor(n));
  for (const [value, glyph] of ROMAN) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

/** Today's edition of the log: a volume per year of the network, a number per day, and the astronomical epoch. */
export function edition(now: number) {
  const date = new Date(now);
  return {
    volume: roman(date.getUTCFullYear() - 2025),
    number: Math.max(1, Math.floor((now - NETWORK_EPOCH) / DAY) + 1),
    epoch: `J${(2000 + (now - J2000) / (365.25 * DAY)).toFixed(2)}`,
    date: date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** A short, stable entry number for a post: the first eight hex digits of its id. */
export function entryNumber(id: string): string {
  const hex = id.replace(/-/g, '').toUpperCase();
  return `${hex.slice(0, 4)}·${hex.slice(4, 8)}`;
}
