import { formatBytes, formatCount } from './format-bytes.js';

export interface WatchTick {
  /** ISO-8601 UTC instant the sample was started. */
  readonly at: string;
  readonly sampledKeys: number;
  readonly usedMemoryBytes: number | null;
  /** Snapshots in the store after this sample, including it. */
  readonly snapshotCount: number;
  /** The pattern this tick's diagnosis named, or `null` when it named none. */
  readonly causePattern: string | null;
}

/**
 * Says whether this tick reached a conclusion, in a few words.
 *
 * Below two snapshots there is nothing to compare, so the honest line is a count of what has
 * accumulated rather than "no cause" — which would read as a finding when it is only a shortage of
 * data. Above it, "no named cause" is a real result: the series was diffed and nothing cleared the
 * attribution bar.
 */
function causeSummary(tick: WatchTick): string {
  if (tick.snapshotCount < 2) {
    return `${formatCount(tick.snapshotCount, false)} snapshot${tick.snapshotCount === 1 ? '' : 's'} so far, nothing to compare yet`;
  }
  return tick.causePattern === null ? 'no named cause' : `cause: ${tick.causePattern}`;
}

/**
 * One line per sample, for a session that may run for days.
 *
 * Deliberately not the report. A watch left running overnight would bury the terminal in repeated
 * paragraphs, and the useful signal across ticks is the shape of the numbers over time — so each
 * line carries the four things that change and nothing that does not. The full diagnosis is one
 * `--snapshots` run away, which is what the closing summary points at.
 */
export function formatWatchTick(tick: WatchTick): string {
  return [
    tick.at,
    `${formatCount(tick.sampledKeys, false)} keys sampled`,
    `${formatBytes(tick.usedMemoryBytes)} used`,
    causeSummary(tick),
  ].join('  ');
}
