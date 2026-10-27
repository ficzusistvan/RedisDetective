/**
 * Strips credentials from a URL so it is safe to print in a log line or an error.
 *
 * Covers Redis passwords, Slack incoming-webhook paths, query tokens, and userinfo.
 * Unparseable input is replaced entirely: if we cannot see the secret, we must not echo it.
 */
export function redactSecretUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '<redacted-url>';
  }

  if (parsed.password !== '') {
    parsed.password = '***';
  }
  if (parsed.username !== '' && parsed.password === '') {
    parsed.username = '***';
  }

  if (isSlackWebhookHost(parsed.hostname)) {
    parsed.pathname = '/services/***';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }

  if (parsed.searchParams.has('token') || parsed.searchParams.has('key')) {
    for (const name of ['token', 'key', 'secret', 'routing_key', 'routingKey']) {
      if (parsed.searchParams.has(name)) {
        parsed.searchParams.set(name, '***');
      }
    }
  }

  return parsed.toString();
}

function isSlackWebhookHost(hostname: string): boolean {
  return hostname === 'hooks.slack.com' || hostname.endsWith('.hooks.slack.com');
}

/**
 * Routing keys and HMAC secrets must never appear in a log line. A placeholder is the
 * only safe rendering — even a prefix can be enough to reconstruct a short token.
 */
export function redactSecretValue(value: string | null | undefined): string {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  return '***';
}
