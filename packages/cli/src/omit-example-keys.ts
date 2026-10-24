/**
 * Drops the "Examples: …" sentence that health-check findings append.
 *
 * Markdown is for a job summary or a PR comment. Example keys — even the
 * `<redacted>` placeholder — do not belong there; the pattern name is enough.
 */
export function omitExampleKeySentence(text: string): string {
  return text.replace(/\s*Examples: [^.]*\./g, '').trimEnd();
}
