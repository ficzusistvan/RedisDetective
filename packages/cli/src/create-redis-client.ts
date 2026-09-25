import { createClient } from 'redis';

import type {
  MemoryUsageRequest,
  RedisCommandClient,
  ScanRequest,
  ScanResponse,
} from '@redis-detective/sampler';

export interface RedisConnection {
  readonly client: RedisCommandClient;
  close(): Promise<void>;
}

export class RedisConnectionError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'RedisConnectionError';
  }
}

type NodeRedisClient = ReturnType<typeof createClient>;

/**
 * `PTTL` answers -1 for a key with no expiry and -2 for a key that no longer exists.
 * Both become `null`, because the sampler only needs "has an expiry or not" and a raw negative
 * number would be read as a TTL by anything downstream.
 */
function normalizePttl(reply: number): number | null {
  return reply < 0 ? null : reply;
}

/**
 * Builds a message for a driver error.
 *
 * Socket errors from node-redis routinely arrive with an empty `message` and only a `code`, which
 * would otherwise print as `Could not connect to redis://host:6379: ` and tell the user nothing.
 */
function describeConnectionFailure(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    if (error.message !== '') {
      return error.message;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') {
      return `${code} (no further detail from the driver)`;
    }
  }
  return fallback;
}

/** Tearing down a read-only session must never be the thing that fails a run. */
function destroyQuietly(raw: NodeRedisClient): void {
  try {
    raw.destroy();
  } catch {
    // Already closed, or never opened.
  }
}

/**
 * Adapts node-redis to `RedisCommandClient`, exposing only the permitted read commands.
 *
 * The adapter lives here rather than in `packages/sampler` so that package stays free of driver
 * dependencies and every sampler test runs against a fake. This is also the single place a driver
 * is chosen, which keeps the read-only promise auditable: the object returned below has no method
 * that can write, and no generic passthrough that would let a caller route around the sampler's
 * bounds.
 */
export async function createRedisClient(
  redisUrl: string,
  connectTimeoutMs: number,
): Promise<RedisConnection> {
  let raw: NodeRedisClient;
  try {
    raw = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: connectTimeoutMs,
        // A diagnostic run is a single shot. Reconnect loops would keep hammering an instance
        // that is already unhealthy, which is the last thing it needs.
        reconnectStrategy: false,
      },
    });
  } catch (error) {
    throw new RedisConnectionError(describeConnectionFailure(error, 'invalid Redis URL'), {
      cause: error,
    });
  }

  // node-redis emits 'error' on the client; without a listener Node treats it as unhandled and
  // tears the process down before we can report anything useful.
  raw.on('error', () => undefined);

  try {
    await raw.connect();
  } catch (error) {
    destroyQuietly(raw);
    throw new RedisConnectionError(
      describeConnectionFailure(error, 'the connection attempt failed with no reported reason'),
      { cause: error },
    );
  }

  const client: RedisCommandClient = {
    info: async (section?: string): Promise<string> =>
      section === undefined ? raw.info() : raw.info(section),

    select: async (db: number): Promise<void> => {
      await raw.select(db);
    },

    dbSize: async (): Promise<number> => raw.dbSize(),

    scan: async (request: ScanRequest): Promise<ScanResponse> => {
      const reply = await raw.scan(request.cursor, { COUNT: request.count });
      return { cursor: String(reply.cursor), keys: reply.keys };
    },

    type: async (key: string): Promise<string> => raw.type(key),

    pttl: async (key: string): Promise<number | null> => normalizePttl(await raw.pTTL(key)),

    memoryUsage: async (key: string, request: MemoryUsageRequest): Promise<number | null> =>
      raw.memoryUsage(key, { SAMPLES: request.samples }),
  };

  return {
    client,
    // `destroy` rather than `quit`: there is nothing to drain in a read-only session, and a
    // half-open socket should never keep the CLI alive.
    close: (): Promise<void> => {
      destroyQuietly(raw);
      return Promise.resolve();
    },
  };
}
