/**
 * Posts or updates a single sticky PR comment for the Redis Detective gate.
 *
 * Looks for an existing comment that contains the marker and PATCHes it; otherwise POSTs.
 * Failures here must not hide the gate result — the caller treats a thrown error as a warning.
 */

export const STICKY_COMMENT_MARKER = '<!-- redis-detective-sticky -->';

const DEFAULT_API = 'https://api.github.com';

/**
 * @param {{
 *   token: string,
 *   repository: string,
 *   issueNumber: number,
 *   markdown: string,
 *   apiBase?: string,
 *   fetchImpl?: typeof fetch,
 * }} request
 * @returns {Promise<{ action: 'created' | 'updated', commentId: number, url: string }>}
 */
export async function postStickyComment(request) {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  const apiBase = (request.apiBase ?? DEFAULT_API).replace(/\/$/, '');
  const [owner, repo] = request.repository.split('/');
  if (owner === undefined || repo === undefined || repo === '') {
    throw new Error(`repository must be owner/repo, received "${request.repository}".`);
  }

  const headers = {
    Authorization: `Bearer ${request.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'redis-detective-action',
  };

  const existing = await findStickyComment({
    fetchImpl,
    apiBase,
    owner,
    repo,
    issueNumber: request.issueNumber,
    headers,
  });

  const body = `${STICKY_COMMENT_MARKER}\n${request.markdown}`;

  if (existing !== null) {
    const updated = await githubJson(
      fetchImpl,
      `${apiBase}/repos/${owner}/${repo}/issues/comments/${String(existing.id)}`,
      { method: 'PATCH', headers, body: JSON.stringify({ body }) },
    );
    return { action: 'updated', commentId: existing.id, url: String(updated['html_url'] ?? '') };
  }

  const created = await githubJson(
    fetchImpl,
    `${apiBase}/repos/${owner}/${repo}/issues/${String(request.issueNumber)}/comments`,
    { method: 'POST', headers, body: JSON.stringify({ body }) },
  );
  return {
    action: 'created',
    commentId: Number(created['id']),
    url: String(created['html_url'] ?? ''),
  };
}

/**
 * @param {string | undefined} eventName
 * @param {unknown} event
 * @returns {number | null}
 */
export function pullRequestNumberFromEvent(eventName, event) {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    return null;
  }
  if (event === null || typeof event !== 'object' || !('pull_request' in event)) {
    return null;
  }
  const pull = event.pull_request;
  if (pull === null || typeof pull !== 'object' || !('number' in pull)) {
    return null;
  }
  const number = pull.number;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
}

async function findStickyComment(request) {
  let page = 1;
  for (;;) {
    const url = `${request.apiBase}/repos/${request.owner}/${request.repo}/issues/${String(request.issueNumber)}/comments?per_page=100&page=${String(page)}`;
    const comments = await githubJson(request.fetchImpl, url, {
      method: 'GET',
      headers: request.headers,
    });
    if (!Array.isArray(comments) || comments.length === 0) {
      return null;
    }
    for (const comment of comments) {
      if (
        comment !== null &&
        typeof comment === 'object' &&
        typeof comment.body === 'string' &&
        comment.body.includes(STICKY_COMMENT_MARKER) &&
        typeof comment.id === 'number'
      ) {
        return { id: comment.id };
      }
    }
    if (comments.length < 100) {
      return null;
    }
    page += 1;
  }
}

async function githubJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      ...init.headers,
      'Content-Type': 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${init.method} ${url} failed (${String(response.status)}).`);
  }
  return text === '' ? {} : JSON.parse(text);
}
