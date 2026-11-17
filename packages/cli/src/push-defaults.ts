/**
 * Largest request body we will build, including a budget for multipart framing.
 *
 * A hosted redis-detective-web function rejects bodies over 4.5 MiB
 * (`FUNCTION_PAYLOAD_TOO_LARGE`) before the app's own check runs. 4 MiB leaves room for a
 * boundary that is longer than the one we budget for.
 */
export const DEFAULT_PUSH_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Snapshots older than this are not uploaded.
 *
 * redis-detective-web drops a stored snapshot whose `capturedAt` is more than 30 days behind
 * the run clock, so sending it only spends the request budget.
 */
export const DEFAULT_PUSH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Lives next to the snapshot files, the same way the alert state file does. */
export const DEFAULT_PUSH_STATE_FILE_NAME = '.redis-detective-push.json';
