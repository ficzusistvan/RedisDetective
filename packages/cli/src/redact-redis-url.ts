/**
 * Strips the password from a Redis URL so it is safe to print.
 *
 * The report, the error paths and the `--json` output all echo the target back to the user, and
 * those get pasted into tickets and chat. A connection string carries a live credential, so the
 * only safe rule is that the raw URL never reaches an output stream — hence a single function that
 * every render path uses.
 *
 * Unparseable input returns a placeholder rather than the original string: if we cannot understand
 * it, we cannot be sure what part of it is secret.
 */
export function redactRedisUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '<unparseable redis url>';
  }

  if (parsed.password !== '') {
    parsed.password = '***';
  }
  return parsed.toString();
}
