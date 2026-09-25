/**
 * A closed time interval. Both bounds are ISO-8601 UTC strings (e.g. `2026-08-25T10:14:00.000Z`)
 * so that snapshots and evidence remain comparable and serialisable across process boundaries.
 */
export interface TimeWindow {
  readonly from: string;
  readonly to: string;
}
