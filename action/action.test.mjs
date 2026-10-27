import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  postStickyComment,
  pullRequestNumberFromEvent,
  STICKY_COMMENT_MARKER,
} from './post-sticky-comment.mjs';
import { cliChildEnv, copyBaseline, parseCliCommand } from './run.mjs';

describe('cliChildEnv', () => {
  it('forwards the Redis URL and strips GitHub credentials', () => {
    const child = cliChildEnv(
      {
        GITHUB_TOKEN: 'ghs_secret',
        GH_TOKEN: 'also_secret',
        GITHUB_APP_ID: '1',
        GITHUB_REPOSITORY: 'acme/app',
        PATH: '/usr/bin',
      },
      'redis://user:hunter2@localhost:6379',
    );

    assert.equal(child['REDIS_URL'], 'redis://user:hunter2@localhost:6379');
    assert.equal(child['REDIS_DETECTIVE_SKIP_GH'], '1');
    assert.equal(child['GITHUB_REPOSITORY'], 'acme/app');
    assert.equal(child['GITHUB_TOKEN'], undefined);
    assert.equal(child['GH_TOKEN'], undefined);
    assert.equal(child['GITHUB_APP_ID'], undefined);
    assert.equal(child['PATH'], '/usr/bin');
  });
});

describe('parseCliCommand', () => {
  it('defaults to npx redis-detective', () => {
    assert.deepEqual(parseCliCommand(''), ['npx', '--yes', 'redis-detective']);
  });

  it('splits a node invocation and keeps quoted paths', () => {
    assert.deepEqual(parseCliCommand('node packages/cli/dist/bin.js'), [
      'node',
      'packages/cli/dist/bin.js',
    ]);
    assert.deepEqual(parseCliCommand('node "path with spaces/bin.js"'), [
      'node',
      'path with spaces/bin.js',
    ]);
  });
});

describe('copyBaseline', () => {
  it('copies a directory of snapshot files and ignores other names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rd-baseline-'));
    try {
      const from = join(root, 'from');
      const to = join(root, 'to');
      await mkdir(from);
      await writeFile(join(from, 'a.snapshot.json'), '{}\n');
      await writeFile(join(from, 'notes.txt'), 'nope\n');
      const copied = await copyBaseline(from, to);
      assert.equal(copied, 1);
      assert.equal(await readFile(join(to, 'a.snapshot.json'), 'utf8'), '{}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renames a lone file so the snapshot store will list it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rd-baseline-file-'));
    try {
      const file = join(root, 'baseline.json');
      await writeFile(file, '{}\n');
      const to = join(root, 'snaps');
      const copied = await copyBaseline(file, to);
      assert.equal(copied, 1);
      assert.equal(await readFile(join(to, 'baseline.json.snapshot.json'), 'utf8'), '{}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('pullRequestNumberFromEvent', () => {
  it('reads a pull_request event and ignores other events', () => {
    assert.equal(pullRequestNumberFromEvent('pull_request', { pull_request: { number: 12 } }), 12);
    assert.equal(pullRequestNumberFromEvent('push', { pull_request: { number: 12 } }), null);
    assert.equal(pullRequestNumberFromEvent('pull_request', {}), null);
  });
});

describe('postStickyComment', () => {
  it('updates an existing sticky comment instead of posting another', async () => {
    const calls = [];
    const fetchImpl = (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (String(url).includes('/issues/4/comments') && init.method === 'GET') {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(JSON.stringify([{ id: 99, body: `${STICKY_COMMENT_MARKER}\nolder` }])),
        });
      }
      if (String(url).includes('/issues/comments/99') && init.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ id: 99, html_url: 'https://example/99' })),
        });
      }
      return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('nope') });
    };

    const result = await postStickyComment({
      token: 'ghs_not_logged',
      repository: 'acme/app',
      issueNumber: 4,
      markdown: '# Redis Memory Diagnosis\n',
      fetchImpl,
    });

    assert.equal(result.action, 'updated');
    assert.equal(result.commentId, 99);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
    assert.ok(String(calls[1]?.body ?? '').includes(STICKY_COMMENT_MARKER));
    assert.ok(!JSON.stringify(calls).includes('ghs_not_logged'));
  });
});
