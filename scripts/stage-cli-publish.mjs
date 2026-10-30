#!/usr/bin/env node

/**
 * Stages a publishable `redis-detective` package.
 *
 * Internal `@redis-detective/*` workspace packages stay private. This script bundles them into
 * `bin.js` (CLI) and `index.js` (programmatic API) so the npm tarball depends only on `redis`
 * (the client) and can be installed with `npx redis-detective` or `import from 'redis-detective'`
 * — no clone, no pnpm, no six-package version matrix.
 *
 * Requires `pnpm build` first: workspace `exports` point at `dist/`, which is what esbuild
 * follows. Library types are inlined from `dist/api.d.ts` so consumers do not see workspace
 * packages.
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
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

import { bundleLibraryDts } from './bundle-library-dts.mjs';
import { testPublishedApi } from './test-published-api.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(repoRoot, 'packages', 'cli');
const outDir = join(cliDir, 'publish');
const binOutfile = join(outDir, 'bin.js');
const libraryOutfile = join(outDir, 'index.js');
const libraryTypes = join(outDir, 'index.d.ts');

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
  'alerts',
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

const sharedBundle = {
  absWorkingDir: repoRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['redis'],
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
};

await esbuild.build({
  ...sharedBundle,
  entryPoints: [join(cliDir, 'src', 'bin.ts')],
  outfile: binOutfile,
});

await esbuild.build({
  ...sharedBundle,
  entryPoints: [join(cliDir, 'src', 'api.ts')],
  outfile: libraryOutfile,
});

assertCliBundle(readFileSync(binOutfile, 'utf8'));
assertLibraryBundle(readFileSync(libraryOutfile, 'utf8'));
chmodSync(binOutfile, 0o755);

const apiDts = join(cliDir, 'dist', 'api.d.ts');
if (!existsSync(apiDts)) {
  fail(`Missing ${apiDts}. Run pnpm build before pnpm pack:cli.`);
}
writeFileSync(libraryTypes, bundleLibraryDts(apiDts));

const rootPackage = readJson(join(repoRoot, 'package.json'));
const publishedLicense = rootPackage.license;
if (typeof publishedLicense !== 'string' || publishedLicense === '') {
  fail('Root package.json is missing a license field.');
}

const publishedPackage = {
  name: PUBLISHED_NAME,
  version: cliPackage.version,
  description:
    "Find out why a Redis instance's memory grew. Read-only CLI and programmatic API: sample, attribute growth to a key pattern, optional GitHub commit candidates.",
  type: 'module',
  license: publishedLicense,
  main: './index.js',
  types: './index.d.ts',
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js',
      default: './index.js',
    },
  },
  bin: {
    [PUBLISHED_NAME]: './bin.js',
  },
  files: ['bin.js', 'index.js', 'index.d.ts'],
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
  keywords: ['redis', 'memory', 'diagnostics', 'cli', 'ttl', 'library'],
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

await assertLibraryRuntimeExports();
typecheckPublishedApi();
await testPublishedApi();

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
const expectedFiles = new Set([
  'bin.js',
  'index.js',
  'index.d.ts',
  'package.json',
  'README.md',
  'LICENSE',
]);
if (
  packedFiles.size !== expectedFiles.size ||
  [...expectedFiles].some((name) => !packedFiles.has(name))
) {
  fail(
    `npm pack must contain exactly ${[...expectedFiles].join(', ')}. Got: ${[...packedFiles].join(', ') || '(unparseable)'}`,
  );
}

process.stdout.write(
  `Staged ${PUBLISHED_NAME}@${cliPackage.version} in packages/cli/publish (bin.js + index.js + redis@${redisVersion}).\n`,
);

function assertNoWorkspaceImports(bundle, label) {
  if (
    /\bfrom\s+["']@redis-detective\//.test(bundle) ||
    /\bimport\s+["']@redis-detective\//.test(bundle)
  ) {
    fail(`${label} still imports @redis-detective/* — internals were not bundled.`);
  }
}

function assertCliBundle(bundle) {
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
  assertNoWorkspaceImports(bundle, 'Staged bin.js');
}

function assertLibraryBundle(bundle) {
  if (bundle.startsWith('#!')) {
    fail('Staged index.js must not have a shebang; it is a library entry, not a CLI.');
  }
  if (!/from\s+['"]redis['"]/.test(bundle)) {
    fail('Staged index.js does not import redis. The client must stay external.');
  }
  assertNoWorkspaceImports(bundle, 'Staged index.js');
  if (bundle.includes('loadDotenv')) {
    fail('Staged index.js must not load .env; that is a CLI-only concern.');
  }
  if (
    bundle.includes("['LLM_API_KEY']") ||
    bundle.includes('["LLM_API_KEY"]') ||
    bundle.includes('.LLM_API_KEY')
  ) {
    fail('Staged index.js must not read LLM_API_KEY; LLM rewording is an explicit option.');
  }
}

async function assertLibraryRuntimeExports() {
  const api = await import(pathToFileURL(libraryOutfile).href);
  for (const name of ['runHealthCheck', 'saveSnapshot', 'loadSnapshots', 'runDiagnosis']) {
    if (typeof api[name] !== 'function') {
      fail(`Staged index.js is missing export ${name}.`);
    }
  }
}

function typecheckPublishedApi() {
  const consumerPath = join(outDir, '_consumer-typecheck.ts');
  writeFileSync(
    consumerPath,
    `import {
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  GitHubRepositoryRefError,
  JSON_REPORT_SCHEMA_VERSION,
  RedisConnectionError,
  StoredSnapshotError,
  loadSnapshots,
  runDiagnosis,
  runHealthCheck,
  saveSnapshot,
} from './index.js';
import type {
  DiagnosisJson,
  DiagnosisOptions,
  HealthCheckJson,
  HealthCheckOptions,
  LoadedSnapshot,
  SaveSnapshotOptions,
  SavedSnapshot,
} from './index.js';

const healthOptions: HealthCheckOptions = { url: 'redis://localhost:6379', redactKeys: true };
const saveOptions: SaveSnapshotOptions = { url: healthOptions.url, directory: './snaps' };
const diagnosisOptions: DiagnosisOptions = { directory: './snaps' };

const health: Promise<HealthCheckJson> = runHealthCheck(healthOptions);
const saved: Promise<SavedSnapshot> = saveSnapshot(saveOptions);
const loaded: Promise<readonly LoadedSnapshot[]> = loadSnapshots('./snaps');
const diagnosis: Promise<DiagnosisJson> = runDiagnosis(diagnosisOptions);

void health;
void saved;
void loaded;
void diagnosis;
void RedisConnectionError;
void StoredSnapshotError;
void GitHubRepositoryRefError;
void JSON_REPORT_SCHEMA_VERSION;
void DIAGNOSIS_REPORT_SCHEMA_VERSION;
void DIAGNOSIS_REPORT_TYPE;
`,
  );

  try {
    execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'tsc'),
      [
        '--noEmit',
        '--strict',
        '--exactOptionalPropertyTypes',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--lib',
        'ES2022',
        '--skipLibCheck',
        consumerPath,
      ],
      { cwd: outDir, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : '';
    fail(
      `Published API types failed to type-check a consumer import.\n${stdout}${stderr}`.trimEnd(),
    );
  } finally {
    unlinkSync(consumerPath);
  }
}
