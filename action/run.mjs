#!/usr/bin/env node

/**
 * Composite-action entrypoint. Samples Redis (optional), diffs against snapshots already
 * in the working directory or copied from `baseline-path`, writes Markdown to the job
 * summary, optionally updates a sticky PR comment, and exits with the CLI's code.
 *
 * Never prints the Redis URL. Credentials belong in env, not argv and not logs.
 */

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { postStickyComment, pullRequestNumberFromEvent } from './post-sticky-comment.mjs';

const SNAPSHOT_SUFFIX = '.snapshot.json';

function env(name) {
  return process.env[name];
}

function readInput(name, fallback = '') {
  const value = env(name);
  return value === undefined ? fallback : value;
}

function parseOptionalNumber(raw, label) {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'off' || trimmed === 'none' || trimmed === 'false') {
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number, or off/none to disable.`);
  }
  return value;
}

function parseBoolean(raw, defaultValue) {
  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }
  const trimmed = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(trimmed)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(trimmed)) {
    return false;
  }
  throw new Error(`Expected a boolean, received "${raw}".`);
}

/**
 * Splits an override such as `node packages/cli/dist/bin.js` on whitespace,
 * keeping double-quoted segments intact. Paths with spaces must be quoted.
 *
 * @param {string} raw
 * @returns {readonly string[]}
 */
/**
 * Environment for the CLI subprocess. GitHub credentials stay with the action
 * process so a diagnosis cannot start commit lookup from GITHUB_REPOSITORY.
 *
 * @param {NodeJS.ProcessEnv} baseEnv
 * @param {string | undefined} redisUrl
 * @returns {NodeJS.ProcessEnv}
 */
export function cliChildEnv(baseEnv, redisUrl) {
  const childEnv = { ...baseEnv };
  if (redisUrl !== undefined && redisUrl !== '') {
    childEnv['REDIS_URL'] = redisUrl;
  }
  childEnv['REDIS_DETECTIVE_SKIP_GH'] = '1';
  delete childEnv['GITHUB_TOKEN'];
  delete childEnv['GH_TOKEN'];
  delete childEnv['GITHUB_APP_ID'];
  delete childEnv['GITHUB_APP_INSTALLATION_ID'];
  delete childEnv['GITHUB_APP_PRIVATE_KEY'];
  delete childEnv['GITHUB_APP_PRIVATE_KEY_PATH'];
  delete childEnv['GITHUB_APP_PRIVATE_KEY_BASE64'];
  return childEnv;
}

export function parseCliCommand(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return ['npx', '--yes', 'redis-detective'];
  }
  const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (parts === null) {
    return ['npx', '--yes', 'redis-detective'];
  }
  return parts.map((part) => part.replace(/^"(.*)"$/s, '$1'));
}

/**
 * @param {string} baselinePath
 * @param {string} snapshotsDir
 * @returns {Promise<number>}
 */
export async function copyBaseline(baselinePath, snapshotsDir) {
  const info = await stat(baselinePath);
  await mkdir(snapshotsDir, { recursive: true });

  if (info.isDirectory()) {
    const names = await readdir(baselinePath);
    let copied = 0;
    for (const name of names) {
      if (!name.endsWith(SNAPSHOT_SUFFIX)) {
        continue;
      }
      await copyFile(join(baselinePath, name), join(snapshotsDir, name));
      copied += 1;
    }
    return copied;
  }

  const destName = basename(baselinePath).endsWith(SNAPSHOT_SUFFIX)
    ? basename(baselinePath)
    : `${basename(baselinePath)}${SNAPSHOT_SUFFIX}`;
  await copyFile(baselinePath, join(snapshotsDir, destName));
  return 1;
}

function appendOutput(name, value) {
  const path = env('GITHUB_OUTPUT');
  if (path === undefined || path === '') {
    return;
  }
  return writeFile(path, `${name}=${value}\n`, { encoding: 'utf8', flag: 'a' });
}

async function appendStepSummary(markdown) {
  const path = env('GITHUB_STEP_SUMMARY');
  if (path === undefined || path === '') {
    return;
  }
  await writeFile(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`, {
    encoding: 'utf8',
    flag: 'a',
  });
}

function runCommand(argv, childEnv) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = argv;
    if (command === undefined) {
      reject(new Error('CLI command is empty.'));
      return;
    }
    const child = spawn(command, args, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function buildCliArgs(options) {
  const args = [
    '--snapshots',
    options.snapshotsDir,
    '--format',
    'markdown',
    '--write-json',
    options.jsonPath,
  ];
  if (options.redactKeys) {
    args.push('--redact-keys');
  }
  if (options.sampleSize !== null) {
    args.push('--sample-size', String(options.sampleSize));
  }
  if (options.timeoutMs !== null) {
    args.push('--timeout', String(options.timeoutMs));
  }
  if (options.memorySamples !== null) {
    args.push('--memory-samples', String(options.memorySamples));
  }
  if (options.databases !== '') {
    args.push('--databases', options.databases);
  }
  if (options.growthPercent !== null) {
    args.push('--fail-on-growth-percent', String(options.growthPercent));
  }
  if (options.growthBytes !== null) {
    args.push('--fail-on-growth-bytes', String(options.growthBytes));
  }
  if (options.ttlDropPoints !== null) {
    args.push('--fail-on-ttl-drop', String(options.ttlDropPoints));
  }
  if (options.newUntimedPatterns) {
    args.push('--fail-on-new-untimed-patterns');
  }
  if (options.warnOnly) {
    args.push('--warn-only');
  }
  return args;
}

function looksLikeSecret(text) {
  const match = /redis:\/\/[^\s/]*:([^@\s]+)@/i.exec(text);
  if (match === null) {
    return false;
  }
  const password = match[1];
  return password !== undefined && password !== '***';
}

async function maybePostComment(markdown) {
  const commentEnabled = parseBoolean(readInput('RD_COMMENT'), true);
  if (!commentEnabled) {
    return;
  }
  const token = env('GITHUB_TOKEN') ?? env('RD_GITHUB_TOKEN') ?? '';
  const repository = env('GITHUB_REPOSITORY') ?? '';
  const eventName = env('GITHUB_EVENT_NAME') ?? '';
  const eventPath = env('GITHUB_EVENT_PATH');
  if (token === '' || repository === '' || eventPath === undefined) {
    return;
  }

  let event;
  try {
    event = JSON.parse(await readFile(eventPath, 'utf8'));
  } catch {
    return;
  }

  const issueNumber = pullRequestNumberFromEvent(eventName, event);
  if (issueNumber === null) {
    return;
  }

  try {
    const result = await postStickyComment({
      token,
      repository,
      issueNumber,
      markdown,
      ...(env('GITHUB_API_URL') === undefined ? {} : { apiBase: env('GITHUB_API_URL') }),
    });
    process.stderr.write(
      `Redis Detective ${result.action} sticky PR comment ${String(result.commentId)}.\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'comment failed';
    process.stderr.write(`Redis Detective could not post a PR comment: ${message}\n`);
  }
}

async function main() {
  const snapshotsDir = readInput('RD_SNAPSHOTS_DIR', '.redis-detective/snapshots');
  const baselinePath = readInput('RD_BASELINE_PATH').trim();
  const outDir = env('RUNNER_TEMP') ?? join(tmpdir(), 'redis-detective-action');
  await mkdir(outDir, { recursive: true });
  const markdownPath = join(outDir, 'redis-detective.md');
  const jsonPath = join(outDir, 'redis-detective.json');

  if (baselinePath !== '') {
    const copied = await copyBaseline(baselinePath, snapshotsDir);
    process.stderr.write(
      `Copied ${String(copied)} baseline snapshot${copied === 1 ? '' : 's'} into ${snapshotsDir}.\n`,
    );
  }

  const failOn = readInput('RD_FAIL_ON', 'fail').trim().toLowerCase();
  if (failOn !== 'fail' && failOn !== 'warn-only') {
    throw new Error(`fail-on must be "fail" or "warn-only", received "${failOn}".`);
  }

  const options = {
    snapshotsDir,
    jsonPath,
    redactKeys: parseBoolean(readInput('RD_REDACT_KEYS'), true),
    sampleSize: parseOptionalNumber(readInput('RD_SAMPLE_SIZE'), 'sample-size'),
    timeoutMs: parseOptionalNumber(readInput('RD_TIMEOUT'), 'timeout'),
    memorySamples: parseOptionalNumber(readInput('RD_MEMORY_SAMPLES'), 'memory-samples'),
    databases: readInput('RD_DATABASES').trim(),
    growthPercent: parseOptionalNumber(readInput('RD_GROWTH_PERCENT', '25'), 'growth-percent'),
    growthBytes: parseOptionalNumber(readInput('RD_GROWTH_BYTES', '10485760'), 'growth-bytes'),
    ttlDropPoints: parseOptionalNumber(readInput('RD_TTL_DROP_POINTS', '20'), 'ttl-drop-points'),
    newUntimedPatterns: parseBoolean(readInput('RD_NEW_UNTIMED_PATTERNS'), true),
    warnOnly: failOn === 'warn-only',
  };

  const cli = [...parseCliCommand(readInput('RD_CLI_COMMAND')), ...buildCliArgs(options)];
  const redisUrl = readInput('RD_REDIS_URL').trim() || env('REDIS_URL');
  const childEnv = cliChildEnv(process.env, redisUrl === '' ? undefined : redisUrl);

  process.stderr.write('Running Redis Detective CI gate (URL omitted from logs).\n');
  const result = await runCommand(cli, childEnv);
  if (result.stderr !== '') {
    const stderr = looksLikeSecret(result.stderr)
      ? 'CLI stderr contained a Redis URL and was suppressed.\n'
      : result.stderr;
    process.stderr.write(stderr);
  }

  const markdown =
    result.stdout.trim() === ''
      ? `# Redis Memory Diagnosis\n\nThe CLI produced no Markdown (exit ${String(result.code)}).\n`
      : result.stdout;

  if (looksLikeSecret(markdown)) {
    throw new Error('Refusing to write a summary that contains a Redis URL with a password.');
  }

  await writeFile(markdownPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  await appendStepSummary(markdown);

  let outcome = result.code === 0 ? 'pass' : result.code === 7 ? 'fail' : 'error';
  let findingsCount = 0;
  try {
    const parsed = JSON.parse(await readFile(jsonPath, 'utf8'));
    const gate = parsed.gate;
    if (gate !== null && typeof gate === 'object') {
      if (typeof gate.outcome === 'string') {
        outcome = gate.outcome;
      }
      if (Array.isArray(gate.findings)) {
        findingsCount = gate.findings.length;
      }
    }
  } catch {
    // First-run or a CLI failure before --write-json landed. Outcome stays from the exit code.
  }

  await appendOutput('outcome', outcome);
  await appendOutput('findings-count', String(findingsCount));
  await appendOutput('markdown-path', markdownPath);
  await appendOutput('json-path', jsonPath);

  await maybePostComment(markdown);

  process.exitCode = result.code;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
