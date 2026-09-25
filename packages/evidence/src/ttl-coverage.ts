/**
 * Fraction of sampled keys carrying a TTL, or `null` when no keys were sampled.
 *
 * Takes the two counts rather than a `KeyPatternStats` so that it also serves callers who have
 * summed several entries together — the same pattern can appear once per data type in a snapshot.
 *
 * `null` rather than `0` for an empty sample: "no keys were looked at" and "no key had a TTL" would
 * otherwise be indistinguishable, and the second is a leak while the first is nothing at all.
 */
export function ttlCoverage(keysWithTtl: number, keysWithoutTtl: number): number | null {
  const total = keysWithTtl + keysWithoutTtl;
  return total <= 0 ? null : keysWithTtl / total;
}
