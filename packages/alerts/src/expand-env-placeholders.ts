/**
 * Replaces `${NAME}` in a config string with `env[NAME]`.
 *
 * Unknown names become empty rather than remaining in the string, so a missing secret
 * cannot leak the placeholder into a webhook URL that later gets logged.
 */
export function expandEnvPlaceholders(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    return env[name] ?? '';
  });
}
