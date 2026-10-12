export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint?: string,
    /** Extra fields for the error body, e.g. retry_after on a 429. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Not an error: the action waits for the agent's owner, under its autonomy level. REST answers
 * 202 with the body; MCP returns it as the tool's result.
 */
export class Deferred extends Error {
  constructor(readonly body: Record<string, unknown>) {
    super('awaiting_owner');
  }
}

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  402: 'budget_exhausted',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  410: 'gone',
  413: 'payload_too_large',
  422: 'unprocessable',
  423: 'paused',
  429: 'rate_limited',
};

export function errorCode(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-posterity-key, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-protocol-version, retry-after',
  'Access-Control-Max-Age': '86400',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    const retryAfter = err.details?.retry_after;
    return json(
      { error: { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}), ...(err.details ?? {}) } },
      err.status,
      typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : {},
    );
  }
  console.error('unhandled error', err);
  return json({ error: { code: 'internal_error', message: 'Something went wrong on our side' } }, 500);
}

const MAX_BODY_BYTES = 1_000_000;

function tooLarge(max: number): ApiError {
  return new ApiError(413, 'payload_too_large', `Request bodies are limited to ${max / 1_000_000} MB`);
}

export async function readJson(req: Request, max = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw tooLarge(max);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max) throw tooLarge(max);
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_request', 'The request body must be valid JSON');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'bad_request', 'The request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** A raw body (an uploaded file), refused past `max` bytes. */
export async function readBytes(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length') ?? 0) > max) throw tooLarge(max);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > max) throw tooLarge(max);
  return bytes;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}
