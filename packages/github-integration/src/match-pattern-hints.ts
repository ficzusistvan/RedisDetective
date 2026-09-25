/**
 * Returns the pattern hints that appear in a commit message or its changed paths.
 *
 * A textual coincidence, not proof. Matching is case-insensitive because Redis key prefixes in
 * code are not spelled consistently; the original hint is what gets recorded, so the report still
 * shows the pattern the evidence named.
 *
 * A hint like `session:` is tried as itself, without the trailing colon (`session` in
 * `src/session/store.ts` or "fix session expiry"), and with colons turned into slashes
 * (`cart:items:` → `cart/items`). That is still a hint: a file named `session` is a reason to
 * look at the commit, not a reason to name it as the cause.
 */
export function matchPatternHints(
  hints: readonly string[],
  message: string,
  changedPaths: readonly string[],
): readonly string[] {
  if (hints.length === 0) {
    return [];
  }

  const haystack = `${message}\n${changedPaths.join('\n')}`;
  return hints.filter((hint) => hint !== '' && haystackMatches(haystack, hint));
}

function haystackMatches(haystack: string, hint: string): boolean {
  const hay = haystack.toLowerCase();
  const needle = hint.toLowerCase();
  if (hay.includes(needle)) {
    return true;
  }

  const stripped = needle.endsWith(':') ? needle.slice(0, -1) : needle;
  if (stripped !== '' && hay.includes(stripped)) {
    return true;
  }

  const asPath = stripped.replace(/:/g, '/');
  return asPath !== stripped && asPath !== '' && hay.includes(asPath);
}
