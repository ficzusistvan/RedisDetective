import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { firingPosts, resolvedPosts, startMockAlertServer } from './mock-alert-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'packages', 'cli', 'dist', 'bin.js');
const writeKeys = join(root, 'examples', 'ttl-drift-demo', 'write-keys.mjs');
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`));
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}

function flushRedis(url) {
  const parsed = new URL(url);
  const port = parsed.port === '' ? 6379 : Number(parsed.port);
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: parsed.hostname, port }, () => {
      socket.write('*1\r\n$7\r\nFLUSHDB\r\n');
    });
    socket.setTimeout(5_000);
    socket.on('data', () => {
      socket.end();
      resolve();
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('FLUSHDB timed out'));
    });
    socket.on('error', reject);
  });
}

describe('watch alerts against the TTL-drift demo', { timeout: 120_000 }, () => {
  it('fires once, does not re-fire inside cooldown, and resolves after the fix', async () => {
    const snaps = await mkdtemp(join(tmpdir(), 'rd-alert-snaps-'));
    const server = await startMockAlertServer();
    /** @type {import('node:child_process').ChildProcess | null} */
    let watch = null;
    let stdout = '';

    try {
      await flushRedis(redisUrl);
      const seed = await run(process.execPath, [writeKeys, '--mode', 'good', '--url', redisUrl]);
      assert.equal(seed.code, 0, seed.err);

      watch = spawn(
        process.execPath,
        [
          cli,
          'watch',
          '--url',
          redisUrl,
          '--snapshots',
          snaps,
          '--interval',
          '10s',
          '--fail-on-ttl-drop',
          '20',
          '--alert-severity',
          'critical',
          '--alert-cooldown',
          '1h',
          '--alert-webhook-url',
          server.webhookUrl,
          '--alert-webhook-secret',
          'e2e-watch',
          '--alert-slack-webhook',
          server.slackUrl,
          '--alert-pagerduty-routing-key',
          'R02E2EWATCH',
          '--alert-pagerduty-events-url',
          server.pagerdutyUrl,
        ],
        { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      watch.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      watch.stderr?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      await waitFor(() => /1 snapshot so far/.test(stdout), 20_000, 'baseline tick');

      const buggy = await run(process.execPath, [writeKeys, '--mode', 'buggy', '--url', redisUrl]);
      assert.equal(buggy.code, 0, buggy.err);

      await waitFor(
        () => firingPosts(server.posts).length >= 3,
        25_000,
        'first firing on all channels',
      );
      const afterFire = firingPosts(server.posts).length;
      assert.equal(
        afterFire,
        3,
        `expected one fire per channel, got ${String(afterFire)}\n${stdout}`,
      );
      assert.match(stdout, /alert firing/);
      assert.match(stdout, /session:\*/);

      await waitFor(
        () => (stdout.match(/keys sampled/g) ?? []).length >= 3,
        20_000,
        'cooldown tick',
      );
      assert.equal(firingPosts(server.posts).length, afterFire, 're-fired inside cooldown');
      assert.match(stdout, /alert suppressed/);

      await flushRedis(redisUrl);
      const fixed = await run(process.execPath, [writeKeys, '--mode', 'good', '--url', redisUrl]);
      assert.equal(fixed.code, 0, fixed.err);

      await waitFor(
        () => resolvedPosts(server.posts).length >= 3,
        25_000,
        'resolve on all channels',
      );
      assert.match(stdout, /alert resolved/);
      assert.equal(firingPosts(server.posts).length, afterFire);

      const webhookFire = server.posts.find(
        (post) => post.path === '/webhook' && post.body.includes('"event":"firing"'),
      );
      assert.ok(webhookFire);
      assert.match(webhookFire.body, /"schemaVersion":1/);
      assert.doesNotMatch(webhookFire.body, /R02E2EWATCH/);
      assert.doesNotMatch(stdout, /R02E2EWATCH/);
    } finally {
      if (watch !== null && watch.exitCode === null) {
        watch.kill('SIGINT');
        await sleep(1_000);
        if (watch.exitCode === null) {
          watch.kill('SIGKILL');
        }
      }
      await server.close();
      await rm(snaps, { recursive: true, force: true });
    }
  });
});
