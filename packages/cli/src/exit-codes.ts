/**
 * Distinct codes so the tool is usable from a script: "could not connect" and "connected, but
 * something in the analysis failed" call for very different follow-up actions.
 */
export const EXIT_CODES = {
  ok: 0,
  unexpectedError: 1,
  usageError: 2,
  connectionError: 3,
  notImplemented: 4,
  /** A snapshot file in --snapshots could not be read as a RedisSnapshot. */
  snapshotError: 5,
  /** GitHub App auth or the commit API failed when --repo was requested. */
  githubError: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
