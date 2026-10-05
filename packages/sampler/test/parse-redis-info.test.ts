import { describe, expect, it } from 'vitest';

import {
  parseKeyspaceFacts,
  parseRedisInfo,
  readInstanceIdentity,
  readMemoryFacts,
  readNumericField,
  readStringField,
} from '@redis-detective/sampler';

import { DEFAULT_FAKE_INFO } from '@redis-detective/sampler/testing';

describe('parseRedisInfo', () => {
  it('parses CRLF output and drops section comments', () => {
    const fields = parseRedisInfo(
      '# Server\r\nredis_version:7.2.4\r\n\r\n# Memory\r\nused_memory:1024\r\n',
    );

    expect(fields.get('redis_version')).toBe('7.2.4');
    expect(fields.get('used_memory')).toBe('1024');
    expect(fields.has('# Server')).toBe(false);
  });

  it('handles LF-only output', () => {
    expect(parseRedisInfo('redis_version:7.2.4\n').get('redis_version')).toBe('7.2.4');
  });

  it('splits on the first colon only, so values may contain colons', () => {
    const fields = parseRedisInfo('master_host:2001:db8::1\r\n');

    expect(fields.get('master_host')).toBe('2001:db8::1');
  });

  it('ignores malformed lines rather than throwing', () => {
    const fields = parseRedisInfo('garbage\r\n:novalue\r\nok:1\r\n');

    expect(fields.get('ok')).toBe('1');
    expect(fields.size).toBe(1);
  });

  it('keeps the last value when a field repeats', () => {
    expect(parseRedisInfo('used_memory:1\r\nused_memory:2\r\n').get('used_memory')).toBe('2');
  });
});

describe('readNumericField', () => {
  const fields = parseRedisInfo('used_memory:1024\r\nratio:1.25\r\nstatus:ok\r\n');

  it('reads integers and floats', () => {
    expect(readNumericField(fields, 'used_memory')).toBe(1_024);
    expect(readNumericField(fields, 'ratio')).toBe(1.25);
  });

  // A missing field and a zero field mean very different things once snapshots are diffed.
  it('returns null for absent and unparseable fields, never zero', () => {
    expect(readNumericField(fields, 'not_present')).toBeNull();
    expect(readNumericField(fields, 'status')).toBeNull();
  });

  it('reads strings separately', () => {
    expect(readStringField(fields, 'status')).toBe('ok');
    expect(readStringField(fields, 'not_present')).toBeNull();
  });
});

describe('parseKeyspaceFacts', () => {
  it('parses per-database lines and sorts by index', () => {
    const facts = parseKeyspaceFacts(
      parseRedisInfo(
        'db2:keys=10,expires=1,avg_ttl=500\r\ndb0:keys=4096,expires=512,avg_ttl=3600000\r\n',
      ),
    );

    expect(facts).toEqual([
      { db: 0, keyCount: 4_096, keysWithExpiry: 512, averageTtlMs: 3_600_000 },
      { db: 2, keyCount: 10, keysWithExpiry: 1, averageTtlMs: 500 },
    ]);
  });

  // Redis reports avg_ttl=0 both when nothing expires and when it has not estimated yet.
  it('reports an avg_ttl of zero as unknown rather than as an average of zero', () => {
    const facts = parseKeyspaceFacts(parseRedisInfo('db0:keys=4,expires=0,avg_ttl=0\r\n'));

    expect(facts[0]?.averageTtlMs).toBeNull();
    expect(facts[0]?.keysWithExpiry).toBe(0);
  });

  it('ignores non-keyspace fields', () => {
    expect(parseKeyspaceFacts(parseRedisInfo('used_memory:1024\r\ndbfoo:keys=1\r\n'))).toEqual([]);
  });
});

describe('readInstanceIdentity', () => {
  it('reads identity from a full INFO dump', () => {
    const identity = readInstanceIdentity(parseRedisInfo(DEFAULT_FAKE_INFO));

    expect(identity).toEqual({
      redisVersion: '7.2.4',
      mode: 'standalone',
      role: 'master',
      maxmemoryBytes: 536_870_912,
      maxmemoryPolicy: 'noeviction',
      uptimeSeconds: 86_400,
    });
  });

  it('treats maxmemory:0 as no configured ceiling', () => {
    expect(readInstanceIdentity(parseRedisInfo('maxmemory:0\r\n')).maxmemoryBytes).toBeNull();
  });

  it('maps the legacy slave role onto replica', () => {
    expect(readInstanceIdentity(parseRedisInfo('role:slave\r\n')).role).toBe('replica');
  });

  // Managed providers redact parts of INFO; admitting ignorance beats claiming master.
  it('reports unknown rather than guessing when fields are absent', () => {
    const identity = readInstanceIdentity(parseRedisInfo(''));

    expect(identity.redisVersion).toBe('unknown');
    expect(identity.mode).toBe('unknown');
    expect(identity.role).toBe('unknown');
    expect(identity.maxmemoryBytes).toBeNull();
  });
});

describe('readMemoryFacts', () => {
  it('reads the measured counters', () => {
    const memory = readMemoryFacts(parseRedisInfo(DEFAULT_FAKE_INFO));

    expect(memory.usedMemoryBytes).toBe(67_108_864);
    expect(memory.usedMemoryRssBytes).toBe(80_530_636);
    expect(memory.memFragmentationRatio).toBe(1.2);
    expect(memory.expiredKeys).toBe(12);
  });

  it('falls back to used_memory when the dataset field is absent', () => {
    const memory = readMemoryFacts(parseRedisInfo('used_memory:2048\r\n'));

    expect(memory.usedMemoryDatasetBytes).toBe(2_048);
    expect(memory.usedMemoryRssBytes).toBe(2_048);
    expect(memory.memFragmentationRatio).toBe(1);
  });

  // A missing field and a real zero mean different things once snapshots are diffed.
  it('leaves a missing used_memory unknown rather than recording zero', () => {
    const memory = readMemoryFacts(parseRedisInfo('used_memory_rss:10\r\n'));

    expect(memory.usedMemoryBytes).toBeNull();
    expect(memory.usedMemoryDatasetBytes).toBeNull();
    expect(memory.usedMemoryPeakBytes).toBeNull();
    expect(memory.usedMemoryRssBytes).toBe(10);
  });

  it('keeps an explicit zero', () => {
    const memory = readMemoryFacts(parseRedisInfo('used_memory:0\r\n'));

    expect(memory.usedMemoryBytes).toBe(0);
    expect(memory.usedMemoryDatasetBytes).toBe(0);
  });
});
