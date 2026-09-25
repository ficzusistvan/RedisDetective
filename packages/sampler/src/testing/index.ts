/**
 * Test doubles, published as `@redis-detective/sampler/testing`.
 *
 * Exposed as a subpath rather than kept in this package's `test/` folder because every package that
 * consumes a `RedisCommandClient` needs the same double. The rule that unit tests touch no network
 * only holds if the alternative is close to hand — and sharing one fake keeps `cli` tests exercising
 * exactly the same simulated Redis (cursor paging, expiring keys, blocked commands) that the
 * sampler's own bound assertions run against.
 *
 * Not part of the runtime surface. Nothing under `src/` outside this folder may import it.
 */
export {
  DEFAULT_FAKE_INFO,
  FakeRedisCommandClient,
  fakeKeys,
} from './fake-redis-command-client.js';
export type { FakeDatabase, FakeKey, FakeRedisOptions } from './fake-redis-command-client.js';
