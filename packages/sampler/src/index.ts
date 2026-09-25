export type {
  MemoryUsageRequest,
  RedisCommandClient,
  ScanRequest,
  ScanResponse,
} from './redis-command-client.js';

export type { SampledKey } from './sampled-key.js';

export {
  SAMPLER_DEFAULTS,
  SAMPLER_HARD_LIMITS,
  SamplerOptionsError,
  resolveSamplerOptions,
} from './sampler-options.js';
export type { ResolvedSamplerOptions, SamplerOptions } from './sampler-options.js';

export { parseRedisInfo, readNumericField, readStringField } from './parse-redis-info.js';
export type { RedisInfoFields } from './parse-redis-info.js';

export { parseKeyspaceFacts } from './parse-keyspace-facts.js';
export { readInstanceIdentity } from './read-instance-identity.js';
export { readMemoryFacts } from './read-memory-facts.js';

export { isMissingKeyType, normalizeDataType } from './normalize-data-type.js';

export {
  KEY_SEGMENT_SEPARATORS,
  inferKeyPattern,
  isHighCardinalitySegment,
} from './infer-key-pattern.js';

export { DEFAULT_SCAN_KEY_SAMPLE_DEPS, scanKeySample } from './scan-key-sample.js';
export type { ScanKeySampleDeps, ScanKeySampleResult } from './scan-key-sample.js';

export { aggregateKeyPatterns } from './aggregate-key-patterns.js';
export type { AggregateKeyPatternsInput } from './aggregate-key-patterns.js';

export { DEFAULT_SAMPLE_REDIS_STATE_DEPS, sampleRedisState } from './sample-redis-state.js';
export type { SampleRedisStateDeps } from './sample-redis-state.js';
