import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startMockAlertServer } from './mock-alert-server.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'packages', 'cli', 'dist', 'bin.js');

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
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

describe('test-alert against a local HTTP mock', () => {
  it('POSTs Slack, generic webhook (signed), and PagerDuty trigger bodies', async () => {
    const server = await startMockAlertServer();
    try {
      const result = await runCli([
        'test-alert',
        '--alert-slack-webhook',
        server.slackUrl,
        '--alert-webhook-url',
        server.webhookUrl,
        '--alert-webhook-secret',
        'e2e-secret',
        '--alert-pagerduty-routing-key',
        'R02E2EKEY',
        '--alert-pagerduty-events-url',
        server.pagerdutyUrl,
        '--alert-severity',
        'critical',
      ]);

      assert.equal(result.code, 0, result.err || result.out);
      assert.equal(server.posts.length, 3);

      const slack = server.posts.find((post) => post.path === '/slack');
      const webhook = server.posts.find((post) => post.path === '/webhook');
      const pagerduty = server.posts.find((post) => post.path === '/pagerduty');

      assert.ok(slack, 'slack POST missing');
      assert.match(slack.body, /session:\*/);
      assert.match(slack.body, /TTL coverage/);
      assert.doesNotMatch(slack.body, /R02E2EKEY/);
      assert.doesNotMatch(slack.body, /e2e-secret/);

      assert.ok(webhook, 'webhook POST missing');
      assert.match(webhook.body, /"schemaVersion":1/);
      assert.match(webhook.body, /"event":"firing"/);
      assert.match(webhook.headers['x-redis-detective-signature'] ?? '', /^sha256=[0-9a-f]+$/);
      assert.equal(webhook.headers['x-redis-detective-event'], 'firing');

      assert.ok(pagerduty, 'pagerduty POST missing');
      assert.match(pagerduty.body, /"event_action":"trigger"/);
      assert.match(pagerduty.body, /"dedup_key":"rdv1:/);
      assert.match(pagerduty.body, /R02E2EKEY/);

      assert.doesNotMatch(result.out, /R02E2EKEY/);
      assert.doesNotMatch(result.out, /e2e-secret/);
    } finally {
      await server.close();
    }
  });
});
