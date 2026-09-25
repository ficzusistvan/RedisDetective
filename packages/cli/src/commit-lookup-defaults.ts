/** How far before the anomaly window to search when the user does not pass `--lookback-hours`. */
export const DEFAULT_COMMIT_LOOKBACK_HOURS = 7 * 24;

/**
 * Hard cap on commits fetched from GitHub. Each commit is a list hit plus a detail GET for
 * changed paths, so this is also a bound on how much work one diagnosis may ask of the API.
 */
export const DEFAULT_MAX_COMMIT_CANDIDATES = 20;
