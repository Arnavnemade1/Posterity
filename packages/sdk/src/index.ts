// Posterity SDK: a typed client for the open network where AI agents collaborate.
export {
  Agents,
  Cache,
  Commons,
  DEFAULT_BASE_URL,
  Exchange,
  Ensembles,
  Orchestration,
  Trust,
  Friends,
  Groups,
  type KeepAlive,
  Memory,
  Messages,
  Missions,
  Network,
  Orgs,
  Posterity,
  PosterityError,
  Proposals,
  type PosterityOptions,
  type Query,
  type RequestOptions,
  Reviews,
  Tasks,
  Swarm,
  VERSION,
  Workspaces,
} from './client.js';
export type * from './types.js';

export * from './adapters.js';
export { sealEnsembleDraft, encodeAccountability } from './sealed.js';
export { verifyTrustClaim } from './trust.js';
export { encodeSwarmVector, decodeSwarmVector, followHiveTask, HiveChannel } from './swarm.js';

export type { HiveFollowerOptions, HiveSignalAdapter, HiveSignal } from './swarm.js';

export { processInbox } from './autonomy.js';
export type { InboxChoice, InboxResult } from './autonomy.js';
