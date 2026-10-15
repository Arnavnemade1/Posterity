// The Posterity GitHub App: its credentials, the tokens it acts with, and a small REST client.
//
// Secrets (Edge Function environment):
//   GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (the .pem GitHub gives you, as is: PKCS#1 or PKCS#8, newlines or
//   "\n", or base64 of the whole file), GITHUB_APP_WEBHOOK_SECRET, GITHUB_APP_CLIENT_ID,
//   GITHUB_APP_CLIENT_SECRET, GITHUB_APP_SLUG. scripts/github-app/create.mjs makes the App and sets them.
// GITHUB_API_URL and GITHUB_URL point the client elsewhere (tests).

export interface GitHubConfig {
  appId: string | null;
  privateKey: string | null;
  webhookSecret: string | null;
  clientId: string | null;
  clientSecret: string | null;
  slug: string | null;
  api: string;
  web: string;
}

const env = (name: string) => Deno.env.get(name)?.trim() || null;

export function githubConfig(): GitHubConfig {
  return {
    appId: env('GITHUB_APP_ID'),
    privateKey: env('GITHUB_APP_PRIVATE_KEY'),
    webhookSecret: env('GITHUB_APP_WEBHOOK_SECRET'),
    clientId: env('GITHUB_APP_CLIENT_ID'),
    clientSecret: env('GITHUB_APP_CLIENT_SECRET'),
    slug: env('GITHUB_APP_SLUG'),
    api: (env('GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, ''),
    web: (env('GITHUB_URL') ?? 'https://github.com').replace(/\/+$/, ''),
  };
}

/** The App can act on repositories (an id and a key are set). */
export const appConfigured = (c = githubConfig()) => Boolean(c.appId && c.privateKey);

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
    /** Seconds until GitHub accepts requests again, for rate limits. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** Not an HTTP failure: the App is not set up on this deployment. */
export class GitHubNotConfigured extends Error {
  constructor() {
    super('The Posterity GitHub App is not set up on this deployment yet');
  }
}

// ----------------------------------------------------------------------------- keys and JWTs

function base64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function base64Url(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let out = '';
  for (let i = 0; i < data.length; i += 0x8000) out += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derNode(tag: number, ...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, p) => sum + p.length, 0);
  const len = derLength(length);
  const out = new Uint8Array(1 + len.length + length);
  out[0] = tag;
  out.set(len, 1);
  let offset = 1 + len.length;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// rsaEncryption (1.2.840.113549.1.1.1) with NULL parameters.
const RSA_ALGORITHM = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);

/** A private key in PKCS#8 DER, from the PEM GitHub issues (PKCS#1, "BEGIN RSA PRIVATE KEY") or PKCS#8. */
export function privateKeyDer(input: string): Uint8Array {
  let pem = input.trim().replace(/\\n/g, '\n');
  if (!pem.includes('-----BEGIN')) {
    // The whole .pem file, base64-encoded (handy for one-line secrets).
    try {
      pem = new TextDecoder().decode(base64ToBytes(pem));
    } catch {
      throw new Error('GITHUB_APP_PRIVATE_KEY is neither a PEM nor base64 of one');
    }
  }
  const match = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/.exec(pem);
  if (!match) throw new Error('GITHUB_APP_PRIVATE_KEY is not a PEM private key');
  const der = base64ToBytes(match[2]);
  if (!match[1]) return der;
  // PKCS#1 RSAPrivateKey inside PrivateKeyInfo { version 0, rsaEncryption, OCTET STRING }.
  return derNode(0x30, new Uint8Array([0x02, 0x01, 0x00]), RSA_ALGORITHM, derNode(0x04, der));
}

let signingKey: { source: string; key: CryptoKey } | undefined;

async function importSigningKey(pem: string): Promise<CryptoKey> {
  if (signingKey?.source === pem) return signingKey.key;
  const key = await crypto.subtle.importKey('pkcs8', new Uint8Array(privateKeyDer(pem)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  signingKey = { source: pem, key };
  return key;
}

let jwtCache: { value: string; expires: number; appId: string } | undefined;

/** The App's own token (RS256, ten minutes), for the installation-token endpoint. */
export async function appJwt(config = githubConfig(), now = Date.now()): Promise<string> {
  if (!config.appId || !config.privateKey) throw new GitHubNotConfigured();
  if (jwtCache && jwtCache.appId === config.appId && jwtCache.expires > now + 60_000) return jwtCache.value;
  const iat = Math.floor(now / 1000) - 60;
  const exp = iat + 540;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iat, exp, iss: config.appId }));
  const key = await importSigningKey(config.privateKey);
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`)));
  const value = `${header}.${payload}.${base64Url(signature)}`;
  jwtCache = { value, expires: exp * 1000, appId: config.appId };
  return value;
}

// ----------------------------------------------------------------------------- the client

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: Fetch;
  base?: string;
}

/** A REST client authenticated as an installation, a user, the App, or nobody (public reads). */
export class GitHub {
  private readonly fetchImpl: Fetch;
  readonly base: string;

  constructor(
    private readonly token: string | null | (() => Promise<string>),
    opts: ClientOptions = {},
  ) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.base = (opts.base ?? githubConfig().api).replace(/\/+$/, '');
  }

  private async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Posterity',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    };
  }

  /** The raw response, for downloads and redirects; errors are left to the caller. */
  async raw(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const url = /^https?:\/\//.test(path) ? path : `${this.base}${path}`;
    return this.fetchImpl(url, { ...init, method, headers: { ...(await this.headers()), ...(init.headers as Record<string, string> | undefined) } });
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.raw(method, path, body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      throw new GitHubError(0, `GitHub could not be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.ok) return data as T;
    const message = (data as { message?: string } | null)?.message ?? `GitHub answered ${res.status}`;
    let retryAfter: number | null = null;
    if (res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')))) {
      const after = Number(res.headers.get('retry-after'));
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      retryAfter = after > 0 ? after : reset > 0 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : 60;
    }
    throw new GitHubError(res.status, `${method} ${path.replace(/\?.*/, '')}: ${message}`, data, retryAfter);
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  delete<T>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** Every page of a list endpoint (up to `max` items); `key` names the array in wrapped responses. */
  async all<T>(path: string, key: string | null = null, max = 1000): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; out.length < max; page++) {
      const sep = path.includes('?') ? '&' : '?';
      const data = await this.get<T[] | Record<string, T[]>>(`${path}${sep}per_page=100&page=${page}`);
      const items = (key ? (data as Record<string, T[]>)[key] : data as T[]) ?? [];
      out.push(...items);
      if (items.length < 100) break;
    }
    return out.slice(0, max);
  }
}

// ----------------------------------------------------------------------------- installations

const installationTokens = new Map<number, { token: string; expires: number }>();

/** A token for one installation, cached until five minutes before GitHub expires it (an hour). */
export async function installationToken(installationId: number, config = githubConfig(), fetchImpl?: Fetch): Promise<string> {
  const hit = installationTokens.get(installationId);
  if (hit && hit.expires > Date.now() + 300_000) return hit.token;
  const app = new GitHub(await appJwt(config), { base: config.api, fetch: fetchImpl });
  const res = await app.post<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, {});
  installationTokens.set(installationId, { token: res.token, expires: Date.parse(res.expires_at) || Date.now() + 3_000_000 });
  return res.token;
}

export function installationClient(installationId: number, config = githubConfig(), fetchImpl?: Fetch): GitHub {
  if (!appConfigured(config)) throw new GitHubNotConfigured();
  return new GitHub(() => installationToken(installationId, config, fetchImpl), { base: config.api, fetch: fetchImpl });
}

/** Forget a cached token, e.g. after GitHub refused it. */
export function dropInstallationToken(installationId: number): void {
  installationTokens.delete(installationId);
}

// ----------------------------------------------------------------------------- webhooks and sign-in

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(body)));
  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** X-Hub-Signature-256 matches the body under the webhook secret. */
export async function verifySignature(secret: string, body: Uint8Array, header: string | null): Promise<boolean> {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  return safeEqual(header.toLowerCase(), await signPayload(secret, body));
}

/** Trade the code from GitHub's authorization redirect for a user token (proves who the person is on GitHub). */
export async function exchangeOAuthCode(code: string, config = githubConfig(), fetchImpl: Fetch = fetch): Promise<string> {
  if (!config.clientId || !config.clientSecret) throw new GitHubNotConfigured();
  const res = await fetchImpl(`${config.web}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Posterity' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
  });
  const data = await res.json().catch(() => null) as { access_token?: string; error?: string; error_description?: string } | null;
  if (!res.ok || !data?.access_token) {
    throw new GitHubError(res.ok ? 400 : res.status, data?.error_description ?? data?.error ?? 'GitHub did not accept the authorization code', data);
  }
  return data.access_token;
}

// ----------------------------------------------------------------------------- names

/** owner/name from "owner/name", a github.com URL, or an SSH remote. */
export function parseRepo(input: string): string | null {
  const text = input.trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[?#].*$/, '');
  const [owner, name] = text.split('/');
  const repo = `${owner}/${name}`;
  return owner && name && /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo) ? repo : null;
}

/** A ref path for the git refs API: each segment encoded, slashes kept. */
export const refPath = (branch: string) => branch.split('/').map(encodeURIComponent).join('/');
