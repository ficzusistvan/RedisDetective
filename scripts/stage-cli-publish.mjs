#!/usr/bin/env node

/**
 * Stages a publishable `redis-detective` package.
 *
 * Internal `@redis-detective/*` workspace packages stay private. This script bundles them into
 * one `bin.js` so the npm tarball depends only on `redis` (the client) and can be installed with
 * `npx redis-detective` — no clone, no pnpm, no six-package version matrix.
 *
 * Requires `pnpm build` first: workspace `exports` point at `dist/`, which is what esbuild
 * follows.
 *
 * Usage: pnpm pack:cli
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(repoRoot, 'packages', 'cli');
const outDir = join(cliDir, 'publish');
const outfile = join(outDir, 'bin.js');

const PUBLISHED_NAME = 'redis-detective';
const REPOSITORY_URL = 'git+https://github.com/ficzusistvan/RedisDetective.git';
const HOMEPAGE = 'https://github.com/ficzusistvan/RedisDetective';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

const cliPackage = readJson(join(cliDir, 'package.json'));
const redisVersion = cliPackage.dependencies?.redis;
if (typeof redisVersion !== 'string' || redisVersion === '') {
  fail('packages/cli/package.json is missing a redis dependency.');
}

const workspacePackages = [
  'core-types',
  'sampler',
  'evidence',
  'github-integration',
  'reasoner',
  'cli',
];
for (const name of workspacePackages) {
  const distIndex = join(repoRoot, 'packages', name, 'dist', 'index.js');
  if (!existsSync(distIndex)) {
    fail(
      `Missing ${distIndex}. Run pnpm build before pnpm pack:cli — workspace exports point at dist/.`,
    );
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  absWorkingDir: repoRoot,
  entryPoints: [join(cliDir, 'src', 'bin.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  external: ['redis'],
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
});

const bundle = readFileSync(outfile, 'utf8');
if (!bundle.startsWith('#!/usr/bin/env node\n')) {
  fail('Staged bin.js is missing its shebang.');
}
if ((bundle.match(/^#!/gm) ?? []).length !== 1) {
  fail(
    'Staged bin.js must have exactly one shebang (esbuild banner + source shebang would break ESM).',
  );
}
if (!/from\s+['"]redis['"]/.test(bundle)) {
  fail('Staged bin.js does not import redis. The client must stay external.');
}
if (
  /\bfrom\s+["']@redis-detective\//.test(bundle) ||
  /\bimport\s+["']@redis-detective\//.test(bundle)
) {
  fail('Staged bin.js still imports @redis-detective/* — internals were not bundled.');
}

chmodSync(outfile, 0o755);

const rootPackage = readJson(join(repoRoot, 'package.json'));
const publishedLicense = rootPackage.license;
if (typeof publishedLicense !== 'string' || publishedLicense === '') {
  fail('Root package.json is missing a license field.');
}

const publishedPackage = {
  name: PUBLISHED_NAME,
  version: cliPackage.version,
  description:
    "Find out why a Redis instance's memory grew. Read-only CLI: sample, attribute growth to a key pattern, optional GitHub commit candidates.",
  type: 'module',
  license: publishedLicense,
  bin: {
    [PUBLISHED_NAME]: './bin.js',
  },
  files: ['bin.js'],
  engines: {
    node: '>=20.11.0',
  },
  repository: {
    type: 'git',
    url: REPOSITORY_URL,
  },
  homepage: HOMEPAGE,
  bugs: {
    url: `${HOMEPAGE}/issues`,
  },
  keywords: ['redis', 'memory', 'diagnostics', 'cli', 'ttl'],
  publishConfig: {
    access: 'public',
  },
  dependencies: {
    redis: redisVersion,
  },
};

const depNames = Object.keys(publishedPackage.dependencies);
if (depNames.length !== 1 || depNames[0] !== 'redis') {
  fail(`Published package.json must depend only on redis, got: ${depNames.join(', ')}`);
}

writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(publishedPackage, null, 2)}\n`);
copyFileSync(join(repoRoot, 'README.md'), join(outDir, 'README.md'));
copyFileSync(join(repoRoot, 'LICENSE'), join(outDir, 'LICENSE'));

const packRaw = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: outDir,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const jsonStart = packRaw.indexOf('[');
if (jsonStart === -1) {
  fail(`npm pack --json did not return an array. Got: ${packRaw.slice(0, 200)}`);
}
const packListing = JSON.parse(packRaw.slice(jsonStart));
const firstEntry = Array.isArray(packListing) ? packListing[0] : undefined;
const packedFiles = new Set(
  firstEntry && Array.isArray(firstEntry.files) ? firstEntry.files.map((entry) => entry.path) : [],
);
const expectedFiles = new Set(['bin.js', 'package.json', 'README.md', 'LICENSE']);
if (
  packedFiles.size !== expectedFiles.size ||
  [...expectedFiles].some((name) => !packedFiles.has(name))
) {
  fail(
    `npm pack must contain exactly ${[...expectedFiles].join(', ')}. Got: ${[...packedFiles].join(', ') || '(unparseable)'}`,
  );
}

process.stdout.write(
  `Staged ${PUBLISHED_NAME}@${cliPackage.version} in packages/cli/publish (bin.js + redis@${redisVersion}).\n`,
);
