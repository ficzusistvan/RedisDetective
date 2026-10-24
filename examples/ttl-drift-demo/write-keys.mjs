#!/usr/bin/env node

/**
 * Tiny write path used by the TTL-drift demo.
 *
 *   node write-keys.mjs --mode good   # SET session:* with EX 3600
 *   node write-keys.mjs --mode buggy  # same keys, EX dropped — the leak
 *
 * `cache:page:*` keeps a TTL in both modes so the report has a control pattern.
 * Talks Redis over a few bytes of RESP so the demo has no extra dependency.
 */

import { connect } from 'node:net';

const SESSION_COUNT = 250;
/**
 * Extra never-expiring session keys written only by the buggy path.
 * Sized so used memory grows past the evidence floor (8 MiB) and the
 * diagnosis can name `session:*` as a Cause, not only as TTL drift.
 */
const BUGGY_EXTRA_SESSIONS = 320;
const BUGGY_VALUE_BYTES = 32 * 1024;
const CACHE_COUNT = 80;
const SESSION_TTL_SECONDS = 3600;
const CACHE_TTL_SECONDS = 120;

function parseArgs(argv) {
  let mode = 'good';
  let url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6380';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const value = argv[index + 1];
      if (value !== 'good' && value !== 'buggy') {
        throw new Error('--mode must be good or buggy.');
      }
      mode = value;
      index += 1;
    } else if (arg === '--url') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('--url expects a Redis URL.');
      }
      url = value;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('write-keys.mjs --mode good|buggy [--url redis://127.0.0.1:6380]\n');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument "${String(arg)}".`);
    }
  }

  return { mode, url };
}

function encodeCommand(parts) {
  const chunks = [Buffer.from(`*${String(parts.length)}\r\n`)];
  for (const part of parts) {
    const payload = Buffer.from(String(part));
    chunks.push(Buffer.from(`$${String(payload.length)}\r\n`), payload, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

function parseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Redis URL is not parseable.');
  }
  const dbRaw = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 6379 : Number(parsed.port),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    db: dbRaw === '' ? 0 : Number(dbRaw),
  };
}

function connectRedis(target) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port }, () => resolve(socket));
    socket.once('error', reject);
  });
}

function writeAll(socket, buffer) {
  return new Promise((resolve, reject) => {
    socket.write(buffer, (error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const { mode, url } = parseArgs(process.argv.slice(2));
  const target = parseUrl(url);
  const socket = await connectRedis(target);

  const commands = [];
  if (target.password !== '') {
    commands.push(
      target.username === ''
        ? ['AUTH', target.password]
        : ['AUTH', target.username, target.password],
    );
  }
  if (target.db !== 0) {
    commands.push(['SELECT', String(target.db)]);
  }

  for (let index = 0; index < SESSION_COUNT; index += 1) {
    const key = `session:${index.toString(16).padStart(8, '0')}`;
    const value = `session-payload-${String(index).padStart(4, '0')}`;
    commands.push(
      mode === 'good'
        ? ['SET', key, value, 'EX', String(SESSION_TTL_SECONDS)]
        : ['SET', key, value],
    );
  }

  if (mode === 'buggy') {
    const pad = 'x'.repeat(BUGGY_VALUE_BYTES);
    for (let index = SESSION_COUNT; index < SESSION_COUNT + BUGGY_EXTRA_SESSIONS; index += 1) {
      const key = `session:${index.toString(16).padStart(8, '0')}`;
      commands.push(['SET', key, `${String(index)}:${pad}`]);
    }
  }

  for (let index = 0; index < CACHE_COUNT; index += 1) {
    commands.push([
      'SET',
      `cache:page:${String(index)}`,
      `html-${String(index)}`,
      'EX',
      String(CACHE_TTL_SECONDS),
    ]);
  }

  await writeAll(socket, Buffer.concat(commands.map(encodeCommand)));
  await new Promise((resolve) => {
    socket.end(resolve);
  });

  const sessionTotal = mode === 'buggy' ? SESSION_COUNT + BUGGY_EXTRA_SESSIONS : SESSION_COUNT;
  process.stdout.write(
    `wrote ${String(sessionTotal)} session:* keys (${mode}) and ${String(CACHE_COUNT)} cache:page:* keys with TTL\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
