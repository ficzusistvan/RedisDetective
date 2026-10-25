/**
 * The HTTP surface notifiers need. Injected so unit tests never open a socket.
 *
 * Production (`packages/cli`) passes a wrapper around `globalThis.fetch`. Implementations
 * must honour `timeoutMs` and must not log the URL or body — those can carry a webhook path
 * or a routing key.
 */
export type AlertFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly timeoutMs: number;
  },
) => Promise<{ readonly status: number; readonly body: string }>;

export type AlertWait = (ms: number) => Promise<void>;

export function defaultAlertWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * `fetch` adapter used by the CLI. `fetchImpl` is required so a test that constructs this
 * cannot silently reach the network.
 */
export function createAlertFetch(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
): AlertFetch {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: init.method,
        headers: { ...init.headers },
        body: init.body,
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  };
}
