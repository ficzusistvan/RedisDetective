import type { RedisKeyspaceFacts } from '@redis-detective/core-types';

import type { RedisInfoFields } from './parse-redis-info.js';

const DB_FIELD = /^db(\d+)$/;

function readSubField(value: string, name: string): number | null {
  for (const pair of value.split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      const parsed = Number(pair.slice(separator + 1).trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

/**
 * Turns the `INFO keyspace` lines into per-database facts.
 *
 * The lines look like `db0:keys=4096,expires=512,avg_ttl=3600000`. Databases with no keys are
 * omitted by Redis entirely, so an absent `db3` means empty rather than unknown — which is why
 * callers should treat a missing database as zero keys but must not treat a missing `avg_ttl` as
 * zero. Sorted by database index so snapshots stay comparable.
 */
export function parseKeyspaceFacts(fields: RedisInfoFields): readonly RedisKeyspaceFacts[] {
  const facts: RedisKeyspaceFacts[] = [];

  for (const [field, value] of fields) {
    const match = DB_FIELD.exec(field);
    if (match === null) {
      continue;
    }

    const db = Number(match[1]);
    if (!Number.isInteger(db)) {
      continue;
    }

    // `avg_ttl` is 0 both when nothing expires and when Redis has not yet estimated it, so a
    // zero is reported as "unknown" rather than as a real average of zero.
    const averageTtlMs = readSubField(value, 'avg_ttl');

    facts.push({
      db,
      keyCount: readSubField(value, 'keys') ?? 0,
      keysWithExpiry: readSubField(value, 'expires') ?? 0,
      averageTtlMs: averageTtlMs === null || averageTtlMs === 0 ? null : averageTtlMs,
    });
  }

  return facts.sort((left, right) => left.db - right.db);
}
