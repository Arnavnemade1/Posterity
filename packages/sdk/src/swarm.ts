import { PosterityError, type Posterity } from './client.js';
import type { HiveSwarmFrame, HiveWorkLease, SwarmVector } from './types.js';

const hash=async(bytes:Uint8Array<ArrayBuffer>)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** Space identifies model/checkpoint/layer semantics; the transport never invents an adapter. */
export async function encodeSwarmVector(space:string,values:ArrayLike<number>):Promise<SwarmVector> {
  if(space.length<3 || space.length>200 || values.length<1 || values.length>16384)throw new Error('Declare a vector space and 1-16384 elements');
  const bytes=new Uint8Array(values.length*4),view=new DataView(bytes.buffer);
  for(let i=0;i<values.length;i++) {
    view.setFloat32(i*4,values[i],true);
    if(!Number.isFinite(values[i]) || !Number.isFinite(view.getFloat32(i*4,true)))throw new Error('Finite float32 values required');
  }
  let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
  return {space,encoding:'f32le-base64',dimensions:values.length,data:btoa(binary),sha256:await hash(bytes)};
}

export async function decodeSwarmVector(vector:SwarmVector,expectedSpace:string):Promise<Float32Array> {
  if(vector.space!==expectedSpace || vector.encoding!=='f32le-base64')throw new Error('Incompatible vector space; use an explicit adapter or text fallback');
  if(!Number.isInteger(vector.dimensions) || vector.dimensions<1 || vector.dimensions>16384 || typeof vector.data!=='string' || vector.data.length>87384)throw new Error('Invalid bounded vector');
  const binary=atob(vector.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(btoa(binary)!==vector.data || bytes.length!==4*vector.dimensions || await hash(bytes)!==vector.sha256)throw new Error('Corrupt vector dimensions or digest');
  const view=new DataView(bytes.buffer),values=new Float32Array(vector.dimensions);
  for(let i=0;i<values.length;i++) {values[i]=view.getFloat32(i*4,true);if(!Number.isFinite(values[i]))throw new Error('Nonfinite vector');}
  return values;
}

function pause(ms:number,signal?:AbortSignal) {
  return new Promise<void>(resolve=>{
    const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
    const timer=setTimeout(done,ms);signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();
  });
}

export interface HiveFollowerOptions {
  after?: number;
  spaces?: string[];
  signal?: AbortSignal;
  pollMs?: number;
  maxIdleMs?: number;
  /** Maximum events fetched per page, 1–100. Default 50. */
  pageSize?: number;
  /** Consecutive transient failures before surfacing an error. Default 5. */
  maxRetries?: number;
  /** Persist only after the consumer resumes, never when a page is merely fetched. */
  saveCursor?: (cursor: number, room: { hiveId: string; taskHash: string }) => void | Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

function transient(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof PosterityError && [408, 429, 500, 502, 503, 504].includes(error.status));
}

/** One in-flight read; drain pages before sleeping. Consumer controls durable acknowledgement. */
export async function* followHiveTask(client: Pick<Posterity, 'swarm'>, task: string, options: HiveFollowerOptions = {}): AsyncGenerator<HiveSwarmFrame> {
  let cursor = options.after ?? 0, idle = 0, last = '', failures = 0;
  let hive: string | undefined;
  const interval = Math.max(500, options.pollMs ?? 1500);
  const maximum = Math.max(interval, options.maxIdleMs ?? 6000);
  const retries = options.maxRetries ?? 5;
  const pageSize = options.pageSize ?? 50;
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isFinite(interval) || !Number.isFinite(maximum) || !Number.isSafeInteger(retries) || retries < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('Finite polling intervals, nonnegative cursor/retry count, and 1–100 events per page required');
  const signature = (frame: HiveSwarmFrame) => JSON.stringify([frame.version, frame.context.task_hash, frame.context.public_activity, frame.context.phase, frame.writable, frame.state_stale, frame.leases, frame.peers.map(p => [p.agent_id, p.acknowledged, p.status, p.online])]);
  const recover = async (error: unknown) => {
    if (!transient(error) || ++failures > retries) throw error;
    // Jitter prevents a disconnected fleet from reconnecting in lockstep.
    const delay = Math.round(Math.min(maximum, interval * 2 ** Math.min(failures - 1, 10)) * (0.8 + Math.random() * 0.4));
    options.onRetry?.(error, failures, delay);
    await pause(delay, options.signal);
  };
  while (!options.signal?.aborted) {
    let frame: HiveSwarmFrame;
    try { frame = await client.swarm.sync(task, { after: cursor, spaces: options.spaces, limit: pageSize, signal: options.signal }); }
    catch (error) {
      if (options.signal?.aborted) return;
      await recover(error);
      continue;
    }
    if (hive !== undefined && hive !== frame.hive_id) throw new Error('Hive changed; resume with the cursor stored for this room');
    hive = frame.hive_id;
    // Never persist or acknowledge an unseen gap, duplicate, or malformed page.
    let delivered = cursor;
    for (const event of frame.events) {
      if (event.sequence !== delivered + 1) throw new Error('Noncontiguous hive events; resume from the last processed cursor');
      delivered = event.sequence;
    }
    if (!Number.isSafeInteger(frame.head) || frame.head < delivered || frame.next_cursor !== delivered || frame.has_more !== (delivered < frame.head)) throw new Error('Invalid hive cursor page');
    const changed = frame.events.length > 0 || last !== signature(frame);
    if (changed) yield frame;
    if (options.signal?.aborted) return;
    // A callback failure stops delivery before any presence acknowledgement.
    if (changed) await options.saveCursor?.(delivered, { hiveId: frame.hive_id, taskHash: frame.context.task_hash });
    cursor = delivered;
    if (frame.context.phase === 'settled') { if (frame.has_more) continue; return; }
    if (frame.writable !== false) {
      try { await client.swarm.pulse(task, frame.context.task_hash, cursor, {}, options.signal); }
      catch (error) {
        if (options.signal?.aborted) return;
        if (error instanceof PosterityError && error.status === 409) { last = ''; await pause(interval, options.signal); continue; }
        // Review or pause can close writes between sync and acknowledgement.
        if (!(error instanceof PosterityError && error.status === 403)) { await recover(error); continue; }
      }
    }
    failures = 0;
    last = signature(frame);
    if (frame.has_more) { idle = 0; continue; }
    idle = changed ? 0 : Math.min(idle + 1, 3);
    await pause(Math.min(maximum, interval * 2 ** idle), options.signal);
  }
}

/** An explicit semantic contract, versioned in space; models supply their own codec. */
export interface HiveSignalAdapter<State> {
  space: string;
  dimensions: number;
  encode(state: State): ArrayLike<number> | Promise<ArrayLike<number>>;
  decode(values: Float32Array): State | Promise<State>;
}
export interface HiveSignal<State> {
  sequence: number;
  agentId: string;
  summary: string;
  /** Stale or incompatible state stays text-only. */
  delivery: 'decoded' | 'incompatible' | 'stale';
  state?: State;
}

/** Typed intra-hive vector channel with text fallback and the same cursor/context fencing as text events. */
export class HiveChannel<State> {
  readonly #adapter: HiveSignalAdapter<State>;
  constructor(readonly client: Pick<Posterity, 'swarm'>, readonly task: string, adapter: HiveSignalAdapter<State>) {
    if (adapter.space.length < 3 || adapter.space.length > 200 || !Number.isInteger(adapter.dimensions) || adapter.dimensions < 1 || adapter.dimensions > 16384) throw new Error('A versioned vector space and bounded dimensions are required');
    this.#adapter = { space: adapter.space, dimensions: adapter.dimensions, encode: adapter.encode.bind(adapter), decode: adapter.decode.bind(adapter) };
  }

  async send(frame: HiveSwarmFrame, state: State, options: { summary: string; lease?: HiveWorkLease; clientId?: string }) {
    if (frame.context.task_id !== this.task || frame.writable === false || frame.context.phase === 'settled' || frame.state_stale) throw new Error('Sync and rebase a writable task context before sending state');
    if (!options.summary.trim() || options.summary.length > 4000) throw new Error('A bounded text fallback is required');
    const lease = options.lease;
    if (lease && (lease.task_id !== this.task || lease.hive_id !== frame.hive_id || lease.task_hash !== frame.context.task_hash || Date.parse(lease.until_at) <= Date.now() || !Number.isFinite(Date.parse(lease.until_at)))) throw new Error('A current lease for this hive and task context is required');
    const values = await this.#adapter.encode(state);
    if (values.length !== this.#adapter.dimensions) throw new Error('Adapter dimensions do not match its declared space');
    const vector = await encodeSwarmVector(this.#adapter.space, values);
    return this.client.swarm.vector(this.task, frame.context.task_hash, vector, { summary: options.summary, work_key: lease?.work_key, token: lease?.token, client_id: options.clientId });
  }

  async *follow(options: Omit<HiveFollowerOptions, 'spaces'> = {}): AsyncGenerator<{ frame: HiveSwarmFrame; signals: HiveSignal<State>[] }> {
    for await (const frame of followHiveTask(this.client, this.task, { ...options, spaces: [this.#adapter.space] })) {
      const signals: HiveSignal<State>[] = [];
      for (const event of frame.events) {
        if (event.result.kind !== 'vector') continue;
        const signal: HiveSignal<State> = { sequence: event.sequence, agentId: event.agent_id, summary: typeof event.result.summary === 'string' ? event.result.summary : '', delivery: event.context_stale ? 'stale' : 'incompatible' };
        const vector = event.result.vector as SwarmVector | undefined;
        if (!event.context_stale && event.compatible && vector?.space === this.#adapter.space) {
          if (vector.dimensions !== this.#adapter.dimensions) throw new Error('Received dimensions violate the adapter contract');
          signal.state = await this.#adapter.decode(await decodeSwarmVector(vector, this.#adapter.space));
          signal.delivery = 'decoded';
        }
        signals.push(signal);
      }
      yield { frame, signals };
    }
  }
}
