import type { RedisCommandClient } from '@redis-detective/sampler';

import { createRedisClient } from './create-redis-client.js';
import type { RedisConnection } from './create-redis-client.js';

/** Same budget the CLI uses for opening a socket. Not a sampling bound. */
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

type ConnectToRedis = (url: string, connectTimeoutMs: number) => Promise<RedisConnection>;

/**
 * Opens a read-only Redis session, runs `fn`, and always closes the socket.
 *
 * The library entry points must not leave a connection behind, including when sampling throws.
 * `connect` is injected so tests can substitute a fake client. `undefined` uses the real driver.
 */
export async function withRedisConnection<T>(
  url: string,
  fn: (client: RedisCommandClient) => Promise<T>,
  connect?: ConnectToRedis,
): Promise<T> {
  const open = connect ?? createRedisClient;
  const connection = await open(url, DEFAULT_CONNECT_TIMEOUT_MS);
  try {
    return await fn(connection.client);
  } finally {
    await connection.close();
  }
}
