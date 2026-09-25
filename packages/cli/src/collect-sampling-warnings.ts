import type { RedisSnapshot } from '@redis-detective/core-types';

/**
 * Every distinct sampling warning across the snapshots in a diagnosis window, verbatim.
 *
 * The sampler already knows *which* bound stopped it — a deadline, a pass ceiling, or a clamp that
 * quietly reduced what the caller asked for. Reducing all of that to `sampling.truncated` leaves a
 * user raising `--timeout` against a ceiling they were never told about, so the strings are carried
 * through unedited: they name the bound and the number the caller would otherwise go on guessing.
 *
 * De-duplicated because a window of snapshots taken with the same options hits the same bound every
 * time, and first-seen order is kept so the same snapshots always render identically.
 */
export function collectSamplingWarnings(snapshots: readonly RedisSnapshot[]): readonly string[] {
  const seen = new Set<string>();
  for (const snapshot of snapshots) {
    for (const warning of snapshot.sampling.warnings) {
      seen.add(warning);
    }
  }
  return [...seen];
}
