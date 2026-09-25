/** Segment separators, in priority order. Redis convention is `:`, but codebases vary. */
export const KEY_SEGMENT_SEPARATORS = [':', '|', '/', '.'] as const;

const WILDCARD = '*';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_DIGITS = /^\d+$/;
/**
 * Hex-looking and at least six characters, but it must contain a digit. The digit requirement is
 * what keeps ordinary words spelled from hex letters — `feedface`, `deadbeef`, `decade` — out,
 * while still catching the short ids (`8f2a1c`) that application code generates.
 */
const HEX_DIGEST = /^(?=.*\d)[0-9a-f]{6,}$/i;
/** Long opaque token (base64url, ULID, nanoid). Mixed case or digits, so `subscriptions` is safe. */
const OPAQUE_TOKEN = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;
/**
 * A name with a numeric id fused onto it, as in `user1234567`.
 *
 * The four-digit floor is a deliberate trade-off. Failing to collapse these fragments one cause
 * into thousands of single-key "patterns", which hides it from the report entirely — the worse of
 * the two failure modes. Requiring four digits keeps common technical names (`sha256`, `base64`,
 * `h264`, `utf8`, `x86`) intact.
 */
const NAME_WITH_NUMERIC_ID = /^[A-Za-z_-]+\d{4,}$/;

/**
 * True when a segment looks like an identifier rather than a name.
 *
 * The distinction that matters for the whole product: `session` is something an engineer wrote in
 * their code, `8f2a1c9b` is something their code generated at runtime. Only the former belongs in
 * a pattern.
 */
export function isHighCardinalitySegment(segment: string): boolean {
  if (segment === '') {
    return false;
  }
  return (
    ALL_DIGITS.test(segment) ||
    UUID.test(segment) ||
    HEX_DIGEST.test(segment) ||
    OPAQUE_TOKEN.test(segment) ||
    NAME_WITH_NUMERIC_ID.test(segment)
  );
}

function chooseSeparator(key: string): string | null {
  for (const separator of KEY_SEGMENT_SEPARATORS) {
    if (key.includes(separator)) {
      return separator;
    }
  }
  return null;
}

/**
 * Collapses a concrete key into the pattern that groups it with its siblings:
 * `session:user:8f2a1c` at depth 2 becomes `session:user:*`.
 *
 * Grouping quality decides whether the final report is actionable. `session:*` is something an
 * engineer recognises as their own code; `session:8f2a1c` is noise that would fragment one cause
 * into thousands of one-key "patterns". Getting this wrong makes every downstream attribution
 * useless however correct the arithmetic.
 *
 * `depth` counts *literal* segments kept, not positions consumed. An identifier-looking segment
 * always collapses to `*` without spending the budget, so `user:8f2a1c:cart` at depth 2 yields
 * `user:*:cart` rather than `user:*:*` — keeping the trailing `cart`, which is the part that
 * names the caller's intent. Consecutive wildcards then collapse into one, so the result stays
 * readable.
 *
 * Deterministic: the same key and depth always produce the same pattern.
 */
export function inferKeyPattern(key: string, depth: number): string {
  const separator = chooseSeparator(key);
  if (separator === null) {
    // A single-segment key is its own pattern unless it is itself an identifier.
    return isHighCardinalitySegment(key) ? WILDCARD : key;
  }

  const segments = key.split(separator);
  const pattern: string[] = [];
  let literalsKept = 0;

  for (const segment of segments) {
    if (isHighCardinalitySegment(segment) || literalsKept >= depth) {
      if (pattern[pattern.length - 1] !== WILDCARD) {
        pattern.push(WILDCARD);
      }
      continue;
    }

    pattern.push(segment);
    literalsKept += 1;
  }

  return pattern.join(separator);
}
