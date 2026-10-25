import { createServer } from 'node:http';

/**
 * One localhost server that records POSTs for Slack, the generic webhook, and
 * a PagerDuty Events API stand-in. Used by the e2e tests only.
 */
export function startMockAlertServer() {
  /** @type {{ path: string, headers: Record<string, string>, body: string }[]} */
  const posts = [];

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[name] = value;
        }
      }
      posts.push({ path: req.url ?? '/', headers, body });
      res.statusCode = 202;
      res.setHeader('content-type', 'application/json');
      res.end('{"status":"ok"}');
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('mock alert server did not bind a port'));
        return;
      }
      const baseUrl = `http://127.0.0.1:${String(address.port)}`;
      resolve({
        baseUrl,
        posts,
        slackUrl: `${baseUrl}/slack`,
        webhookUrl: `${baseUrl}/webhook`,
        pagerdutyUrl: `${baseUrl}/pagerduty`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => {
              if (error) {
                fail(error);
                return;
              }
              done();
            });
          }),
      });
    });
    server.on('error', reject);
  });
}

export function firingPosts(posts) {
  return posts.filter((post) => {
    if (post.path === '/webhook') {
      return post.body.includes('"event":"firing"');
    }
    if (post.path === '/pagerduty') {
      return post.body.includes('"event_action":"trigger"');
    }
    return post.body.includes('Redis memory alert') && !post.body.includes('resolved');
  });
}

export function resolvedPosts(posts) {
  return posts.filter((post) => {
    if (post.path === '/webhook') {
      return post.body.includes('"event":"resolved"');
    }
    if (post.path === '/pagerduty') {
      return post.body.includes('"event_action":"resolve"');
    }
    return post.body.includes('Redis memory alert resolved');
  });
}
