import type {
  MemoryUsageRequest,
  RedisCommandClient,
  ScanRequest,
  ScanResponse,
} from '../redis-command-client.js';

export interface FakeKey {
  readonly type?: string;
  /** `null` or omitted means no expiry is set. */
  readonly ttlMs?: number | null;
  readonly bytes?: number | null;
}

export type FakeDatabase = Readonly<Record<string, FakeKey>>;

export interface FakeRedisOptions {
  readonly info?: string;
  readonly databases?: Readonly<Record<number, FakeDatabase>>;
  /** Simulates a managed provider that blocks `MEMORY USAGE`. */
  readonly memoryUsageBlocked?: boolean;
  /** Milliseconds the fake clock advances per command, for exercising the deadline bound. */
  readonly msPerCommand?: number;
}

export const DEFAULT_FAKE_INFO = [
  '# Server',
  'redis_version:7.2.4',
  'redis_mode:standalone',
  'uptime_in_seconds:86400',
  '# Memory',
  'used_memory:67108864',
  'used_memory_rss:80530636',
  'used_memory_dataset:60397977',
  'used_memory_peak:67108864',
  'mem_fragmentation_ratio:1.20',
  'maxmemory:536870912',
  'maxmemory_policy:noeviction',
  '# Stats',
  'evicted_keys:0',
  'expired_keys:12',
  '# Replication',
  'role:master',
  '# Keyspace',
  'db0:keys=4,expires=2,avg_ttl=3600000',
].join('\r\n');

/**
 * In-memory Redis for tests, backed by a real keyspace and a real cursor-paged `SCAN`.
 *
 * Records every command so tests can assert the sampler stayed inside its bounds. That, rather
 * than merely avoiding a live Redis, is the point of this fake: hard rule 1 in
 * packages/sampler/AGENTS.md only stays true if something checks it.
 *
 * `SCAN` models the cursor as an index into the database's key list. A cursor past the end returns
 * an empty page and cursor `'0'`, which is exactly what a randomized start cursor can hit against
 * a real instance.
 */
export class FakeRedisCommandClient implements RedisCommandClient {
  readonly issuedCommands: string[] = [];

  private readonly options: FakeRedisOptions;

  private readonly databases: Readonly<Record<number, FakeDatabase>>;

  private selectedDb = 0;

  private elapsedMs = 0;

  constructor(options: FakeRedisOptions = {}) {
    this.options = options;
    this.databases = options.databases ?? { 0: {} };
  }

  /** Fake clock, advanced by command traffic so deadline behaviour is deterministic. */
  now(): number {
    return this.elapsedMs;
  }

  countCommands(name: string): number {
    return this.issuedCommands.filter((command) => command.startsWith(name)).length;
  }

  private record(command: string): void {
    this.issuedCommands.push(command);
    this.elapsedMs += this.options.msPerCommand ?? 0;
  }

  private keysOf(db: number): readonly string[] {
    return Object.keys(this.databases[db] ?? {});
  }

  info(section?: string): Promise<string> {
    this.record(section === undefined ? 'INFO' : `INFO ${section}`);
    return Promise.resolve(this.options.info ?? DEFAULT_FAKE_INFO);
  }

  select(db: number): Promise<void> {
    this.record(`SELECT ${db}`);
    this.selectedDb = db;
    return Promise.resolve();
  }

  dbSize(): Promise<number> {
    this.record('DBSIZE');
    return Promise.resolve(this.keysOf(this.selectedDb).length);
  }

  scan(request: ScanRequest): Promise<ScanResponse> {
    this.record(`SCAN ${request.cursor} COUNT ${request.count}`);

    const keys = this.keysOf(this.selectedDb);
    const start = Number(request.cursor);
    if (!Number.isInteger(start) || start < 0 || start >= keys.length) {
      return Promise.resolve({ cursor: '0', keys: [] });
    }

    const end = Math.min(start + request.count, keys.length);
    return Promise.resolve({
      cursor: end >= keys.length ? '0' : String(end),
      keys: keys.slice(start, end),
    });
  }

  type(key: string): Promise<string> {
    this.record(`TYPE ${key}`);
    const entry = this.databases[this.selectedDb]?.[key];
    if (entry === undefined) {
      return Promise.resolve('none');
    }
    return Promise.resolve(entry.type ?? 'string');
  }

  pttl(key: string): Promise<number | null> {
    this.record(`PTTL ${key}`);
    return Promise.resolve(this.databases[this.selectedDb]?.[key]?.ttlMs ?? null);
  }

  memoryUsage(key: string, request: MemoryUsageRequest): Promise<number | null> {
    this.record(`MEMORY USAGE ${key} SAMPLES ${request.samples}`);
    if (this.options.memoryUsageBlocked === true) {
      return Promise.reject(new Error("ERR unknown command 'MEMORY'"));
    }
    return Promise.resolve(this.databases[this.selectedDb]?.[key]?.bytes ?? 100);
  }
}

/** Builds `count` keys under one prefix, each with the same shape. */
export function fakeKeys(
  prefix: string,
  count: number,
  shape: FakeKey = {},
): Record<string, FakeKey> {
  const database: Record<string, FakeKey> = {};
  for (let index = 0; index < count; index += 1) {
    database[`${prefix}${index}`] = shape;
  }
  return database;
}
