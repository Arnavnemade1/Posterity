import { ApiError } from './http.ts';

export type Input = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): boolean => typeof value === 'string' && UUID_RE.test(value);

function bad(message: string): never {
  throw new ApiError(400, 'bad_request', message);
}

const missing = (value: unknown) => value === undefined || value === null || value === '';

export function str(
  input: Input,
  key: string,
  opts: { required?: boolean; max?: number; trim?: boolean } = {},
): string | undefined {
  const value = input[key];
  if (missing(value)) {
    if (opts.required) bad(`${key} is required`);
    return undefined;
  }
  if (typeof value !== 'string') bad(`${key} must be a string`);
  const text = opts.trim === false ? value : value.trim();
  if (opts.required && !text) bad(`${key} is required`);
  if (opts.max !== undefined && text.length > opts.max) bad(`${key} must be at most ${opts.max} characters`);
  return text;
}

export function int(input: Input, key: string, opts: { min?: number; max?: number } = {}): number | undefined {
  const value = input[key];
  if (missing(value)) return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n)) bad(`${key} must be an integer`);
  if (opts.min !== undefined && n < opts.min) bad(`${key} must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) bad(`${key} must be at most ${opts.max}`);
  return n;
}

export function bool(input: Input, key: string): boolean | undefined {
  const value = input[key];
  if (missing(value)) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  bad(`${key} must be true or false`);
}

/** Accepts a JSON array of strings or a comma-separated string. */
export function strList(input: Input, key: string, opts: { max?: number; itemMax?: number } = {}): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  const list = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) bad(`${key} must be an array of strings`);
  const items = (list as string[]).map((item) => item.trim()).filter(Boolean);
  if (opts.max !== undefined && items.length > opts.max) bad(`${key} can have at most ${opts.max} items`);
  if (opts.itemMax !== undefined && items.some((item) => item.length > opts.itemMax!)) {
    bad(`each item in ${key} must be at most ${opts.itemMax} characters`);
  }
  return items;
}

export function id(input: Input, key: string): string {
  const value = input[key];
  if (!isUuid(value)) bad(`${key} must be a valid id (UUID)`);
  return value as string;
}

export function optionalId(input: Input, key: string): string | undefined {
  return missing(input[key]) ? undefined : id(input, key);
}

export function oneOf<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
  const value = input[key];
  if (missing(value)) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) bad(`${key} must be one of: ${values.join(', ')}`);
  return value as T;
}

export function object(input: Input, key: string): Record<string, unknown> | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) bad(`${key} must be a JSON object`);
  return value as Record<string, unknown>;
}

export function array(input: Input, key: string, max: number): unknown[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) bad(`${key} must be an array`);
  if (value.length > max) bad(`${key} can have at most ${max} items`);
  return value;
}
