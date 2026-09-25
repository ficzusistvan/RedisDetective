/**
 * How long `watch` sleeps between samples.
 *
 * Fifteen minutes because coverage improves by spreading *more* bounded samples over time, not by
 * taking denser ones: two samples a minute apart describe the same minute of the key space.
 */
export const DEFAULT_WATCH_INTERVAL_MS = 15 * 60 * 1_000;

/**
 * The floor under `--interval`.
 *
 * Each sample is bounded by `SAMPLER_HARD_LIMITS`, but the interval is the only *gap* between two
 * of them, so a one-second interval would mean near-continuous scanning of a production instance —
 * the load shape hard rule 1 exists to prevent. Enforced as a usage error rather than a clamp,
 * because silently sampling less often than asked would make the snapshot series misreport its own
 * resolution.
 */
export const MIN_WATCH_INTERVAL_MS = 10 * 1_000;
