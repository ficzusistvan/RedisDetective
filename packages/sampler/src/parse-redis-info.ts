/**
 * Flattened `INFO` output: `used_memory` → `1048576`. Section headers (`# Memory`) are dropped;
 * `db0:keys=1,expires=0,avg_ttl=0` lines are kept verbatim under their `db0` key for
 * `parseKeyspaceFacts` to handle.
 */
export type RedisInfoFields = ReadonlyMap<string, string>;

/**
 * Parses raw `INFO` text into a field map.
 *
 * Kept separate from the code that interprets those fields so the wire format — CRLF endings,
 * `#` section comments, values that themselves contain colons — is handled in exactly one place.
 */
export function parseRedisInfo(raw: string): RedisInfoFields {
  const fields = new Map<string, string>();

  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    // Split on the first colon only: values such as `rdb_last_bgsave_status:ok` are simple, but
    // `master_host` and the keyspace lines can contain further colons.
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    // Last occurrence wins, matching how Redis itself would read a duplicated field.
    fields.set(line.slice(0, separator), line.slice(separator + 1));
  }

  return fields;
}

/**
 * Reads a field as a number, or `null` when it is absent or unparseable.
 *
 * Returning `null` rather than `0` is deliberate. A missing field and a zero field mean very
 * different things once snapshots are diffed: coercing "this Redis build does not report
 * `used_memory_dataset`" into "the dataset is empty" would invent growth that never happened.
 */
export function readNumericField(fields: RedisInfoFields, field: string): number | null {
  const raw = fields.get(field);
  if (raw === undefined) {
    return null;
  }

  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

export function readStringField(fields: RedisInfoFields, field: string): string | null {
  const raw = fields.get(field);
  return raw === undefined ? null : raw.trim();
}
