#!/usr/bin/env node

/**
 * Stages a publishable `@redis-detective/core` package.
 *
 * Bundles core-types, evidence and reasoner into a single `index.js` with no runtime
 * dependencies, so the private web runner can depend on the published package without a
 * workspace. Fixtures and the snapshot JSON Schema ship alongside so both repos test the same
 * contract.
 *
 * Requires `pnpm build` first.
 *
 * Usage: pnpm pack:core
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

import { bundleLibraryDts } from './bundle-library-dts.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = join(repoRoot, 'packages', 'core');
const outDir = join(coreDir, 'publish');
const libraryOutfile = join(outDir, 'index.js');
const libraryTypes = join(outDir, 'index.d.ts');

const PUBLISHED_NAME = '@redis-detective/core';
const REPOSITORY_URL = 'git+https://github.com/ficzusistvan/RedisDetective.git';
const HOMEPAGE = 'https://github.com/ficzusistvan/RedisDetective';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function fail(message) {
  throw new Error(message);
}

const corePackage = readJson(join(coreDir, 'package.json'));
const cliPackage = readJson(join(repoRoot, 'packages', 'cli', 'package.json'));
if (corePackage.version !== cliPackage.version) {
  fail(
    `packages/core version ${corePackage.version} must equal packages/cli version ${cliPackage.version}.`,
  );
}

const bundledPackages = ['core-types', 'evidence', 'reasoner', 'core'];
for (const name of bundledPackages) {
  const distIndex = join(repoRoot, 'packages', name, 'dist', 'index.js');
  if (!existsSync(distIndex)) {
    fail(
      `Missing ${distIndex}. Run pnpm build before pnpm pack:core — workspace exports point at dist/.`,
    );
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  absWorkingDir: repoRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  entryPoints: [join(coreDir, 'src', 'index.ts')],
  outfile: libraryOutfile,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
});

const bundle = readFileSync(libraryOutfile, 'utf8');
assertCoreBundle(bundle);

const entryDts = join(coreDir, 'dist', 'index.d.ts');
if (!existsSync(entryDts)) {
  fail(`Missing ${entryDts}. Run pnpm build before pnpm pack:core.`);
}
writeFileSync(libraryTypes, bundleLibraryDts(entryDts, { preserveAllExports: true }));

copyFileSync(join(coreDir, 'snapshot-file.schema.json'), join(outDir, 'snapshot-file.schema.json'));
copyFileSync(join(coreDir, 'SNAPSHOT_FORMAT.md'), join(outDir, 'SNAPSHOT_FORMAT.md'));
cpSync(join(coreDir, 'fixtures', 'golden'), join(outDir, 'fixtures', 'golden'), {
  recursive: true,
});
copyFileSync(join(repoRoot, 'LICENSE'), join(outDir, 'LICENSE'));
copyFileSync(join(coreDir, 'README.md'), join(outDir, 'README.md'));

const rootPackage = readJson(join(repoRoot, 'package.json'));
const publishedLicense = rootPackage.license;
if (typeof publishedLicense !== 'string' || publishedLicense === '') {
  fail('Root package.json is missing a license field.');
}

const publishedPackage = {
  name: PUBLISHED_NAME,
  version: corePackage.version,
  description: corePackage.description,
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
    './snapshot-file.schema.json': './snapshot-file.schema.json',
  },
  files: [
    'index.js',
    'index.d.ts',
    'snapshot-file.schema.json',
    'SNAPSHOT_FORMAT.md',
    'fixtures',
    'README.md',
    'LICENSE',
  ],
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
  keywords: ['redis', 'memory', 'diagnostics', 'evidence', 'ttl'],
  publishConfig: {
    access: 'public',
  },
};

if ('dependencies' in publishedPackage && publishedPackage.dependencies !== undefined) {
  fail('Published @redis-detective/core must have no dependencies.');
}

writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(publishedPackage, null, 2)}\n`);

await assertRuntimeExports();
typecheckPublishedApi();

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
  'index.js',
  'index.d.ts',
  'snapshot-file.schema.json',
  'SNAPSHOT_FORMAT.md',
  'package.json',
  'README.md',
  'LICENSE',
  ...listGoldenPaths(join(outDir, 'fixtures', 'golden')).map((p) => `fixtures/golden/${p}`),
]);

if (
  packedFiles.size !== expectedFiles.size ||
  [...expectedFiles].some((name) => !packedFiles.has(name))
) {
  const missing = [...expectedFiles].filter((name) => !packedFiles.has(name));
  const extra = [...packedFiles].filter((name) => !expectedFiles.has(name));
  fail(
    `npm pack file list mismatch.\nMissing: ${missing.join(', ') || '(none)'}\nExtra: ${extra.join(', ') || '(none)'}`,
  );
}

assertPackedFilesHaveNoLocalPaths(outDir, packedFiles);

process.stdout.write(
  `Staged ${PUBLISHED_NAME}@${corePackage.version} in packages/core/publish (bundled, no dependencies).\n`,
);

function listGoldenPaths(dir, prefix = '') {
  const paths = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      paths.push(...listGoldenPaths(join(dir, entry.name), rel));
    } else {
      paths.push(rel);
    }
  }
  return paths;
}

/**
 * Published fixtures must not leak the machine that generated them.
 * Fail the pack if any packed file contains a Unix home path or a Windows drive path.
 */
function assertPackedFilesHaveNoLocalPaths(root, packed) {
  // Windows drive paths are `C:\` / `C:/…`. Do not treat `https://` as a drive letter.
  const localPath = /\/Users\/|\/home\/|[A-Za-z]:\\|(?:^|[^a-zA-Z0-9])[A-Za-z]:\/(?!\/)/;
  const offenders = [];
  for (const relative of packed) {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) {
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    if (localPath.test(text)) {
      offenders.push(relative);
    }
  }
  if (offenders.length > 0) {
    fail(
      `Packed files contain a local filesystem path (/Users/, /home/, or a Windows drive letter):\n${offenders.join('\n')}`,
    );
  }
}

function assertCoreBundle(text) {
  if (text.startsWith('#!')) {
    fail('Staged index.js must not have a shebang; it is a library entry.');
  }
  if (
    /\bfrom\s+["']@redis-detective\//.test(text) ||
    /\bimport\s+["']@redis-detective\//.test(text)
  ) {
    fail('Staged index.js still imports @redis-detective/* — internals were not bundled.');
  }
  if (/\bfrom\s+["']node:/.test(text) || /\bimport\s+["']node:/.test(text)) {
    fail('Staged index.js still imports node:* — core must stay side-effect-free.');
  }
  if (/\bfrom\s+["']redis["']/.test(text) || /\bimport\s+["']redis["']/.test(text)) {
    fail('Staged index.js must not depend on redis.');
  }
}

async function assertRuntimeExports() {
  const api = await import(pathToFileURL(libraryOutfile).href);
  for (const name of [
    'parseStoredSnapshot',
    'serializeSnapshotFile',
    'snapshotFileName',
    'resolveEvidenceOptions',
    'buildEvidenceGraph',
    'explainEvidence',
    'toDiagnosisJson',
    'diagnoseSnapshots',
    'StoredSnapshotError',
    'EvidenceOptionsError',
    'SnapshotOrderingError',
    'evaluateAlertTick',
    'evaluateAlertRules',
    'transitionAlertState',
    'alertFingerprint',
    'pagerdutyDedupKey',
    'DEFAULT_ALERT_COOLDOWN_MS',
  ]) {
    if (api[name] === undefined) {
      fail(`Staged index.js is missing export ${name}.`);
    }
  }
}

function typecheckPublishedApi() {
  const consumerPath = join(outDir, '_consumer-typecheck.ts');
  writeFileSync(
    consumerPath,
    `import {
  DEFAULT_ALERT_COOLDOWN_MS,
  DIAGNOSIS_REPORT_SCHEMA_VERSION,
  DIAGNOSIS_REPORT_TYPE,
  EVIDENCE_DEFAULTS,
  EvidenceOptionsError,
  SNAPSHOT_FILE_SCHEMA_VERSION,
  SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS,
  SnapshotOrderingError,
  StoredSnapshotError,
  alertFingerprint,
  buildEvidenceGraph,
  diagnoseSnapshots,
  evaluateAlertTick,
  explainEvidence,
  pagerdutyDedupKey,
  parseStoredSnapshot,
  resolveEvidenceOptions,
  serializeSnapshotFile,
  snapshotFileName,
  toDiagnosisJson,
  transitionAlertState,
} from './index.js';
import type {
  AlertContext,
  AlertRule,
  AlertStateRecord,
  DiagnosisJson,
  EvidenceGraph,
  EvidenceOptions,
  Explanation,
  RedisSnapshot,
} from './index.js';

const options: EvidenceOptions = {};
const resolved = resolveEvidenceOptions(options);
const snapshots: readonly RedisSnapshot[] = [];
const graph: EvidenceGraph = buildEvidenceGraph({
  snapshots,
  builtAt: '2026-01-01T00:00:00.000Z',
  options: resolved,
});
const explanation: Promise<Explanation> = explainEvidence({
  graph,
  commitCandidates: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
});
const diagnosis: Promise<DiagnosisJson> = diagnoseSnapshots({
  snapshots,
  generatedAt: '2026-01-01T00:00:00.000Z',
  storeLocation: './snaps',
});
const context: AlertContext = { host: 'redis://localhost', likelyCause: null, commitHints: [] };
const rules: readonly AlertRule[] = [];
const previous: readonly AlertStateRecord[] = [];
const alertTick = evaluateAlertTick({
  host: 'redis://localhost',
  occurredAt: '2026-01-01T00:00:00.000Z',
  nowMs: 0,
  cooldownMs: DEFAULT_ALERT_COOLDOWN_MS,
  context,
  rules,
  snapshots,
  previous,
});

void diagnosis;
void explanation;
void alertTick;
void serializeSnapshotFile;
void snapshotFileName;
void parseStoredSnapshot;
void toDiagnosisJson;
void StoredSnapshotError;
void EvidenceOptionsError;
void SnapshotOrderingError;
void SNAPSHOT_FILE_SCHEMA_VERSION;
void SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS;
void DIAGNOSIS_REPORT_SCHEMA_VERSION;
void DIAGNOSIS_REPORT_TYPE;
void EVIDENCE_DEFAULTS;
void alertFingerprint;
void pagerdutyDedupKey;
void transitionAlertState;
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
      `Published @redis-detective/core types failed to type-check a consumer import.\n${stdout}${stderr}`.trimEnd(),
    );
  } finally {
    unlinkSync(consumerPath);
  }
}
