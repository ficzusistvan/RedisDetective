import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXIT_CODES,
  createFileSnapshotStore,
  createMemorySnapshotStore,
  main,
  renderMarkdownDiagnosis,
  renderTextDiagnosis,
  runDiagnosis,
} from '@redis-detective/cli';
import type { DiagnosisJson, DiagnosisReport, MainContext } from '@redis-detective/cli';

const goldenRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'fixtures',
  'golden',
);
const GENERATED_AT = new Date('2026-08-25T14:00:00.000Z');

const CASES = [
  'flat-no-growth',
  'single-snapshot',
  'below-threshold-growth',
  'clear-leak',
  'ttl-drift',
  'snapshot-gap',
] as const;

function storePlaceholder(caseName: string): string {
  return `<fixtures>/${caseName}/snapshots`;
}

function loadExpected(caseName: string): DiagnosisJson {
  return JSON.parse(
    readFileSync(join(goldenRoot, caseName, 'expected.diagnosis.json'), 'utf8'),
  ) as DiagnosisJson;
}

function loadExpectedText(caseName: string): string {
  return readFileSync(join(goldenRoot, caseName, 'expected.text.txt'), 'utf8');
}

function loadExpectedMarkdown(caseName: string): string {
  return readFileSync(join(goldenRoot, caseName, 'expected.markdown.md'), 'utf8');
}

function stripVolatile(diagnosis: DiagnosisJson): Omit<
  DiagnosisJson,
  'storeLocation' | 'target' | 'savedLocation'
> {
  const { storeLocation: _s, target: _t, savedLocation: _l, ...rest } = diagnosis;
  return rest;
}

/**
 * Goldens are path- and clock-stable. Replace any absolute store location with the fixture
 * placeholder so a checkout on another machine still matches.
 */
function normalizeProse(text: string, caseName: string): string {
  const placeholder = storePlaceholder(caseName);
  const caseDir = join(goldenRoot, caseName);
  const snapshotsDir = join(caseDir, 'snapshots');
  return text
    .split(snapshotsDir)
    .join(placeholder)
    .split(caseDir)
    .join(placeholder)
    .replace(/Store\s+\/(?:Users|home)\/[^\n]+/g, `Store      ${placeholder}`)
    .replace(/\*\*Store:\*\* \/(?:Users|home)\/[^\n]+/g, `**Store:** ${placeholder}`)
    .replace(/\*\*Store:\*\* [A-Za-z]:[\\/][^\n]+/g, `**Store:** ${placeholder}`)
    .replace(/Store\s+[A-Za-z]:[\\/][^\n]+/g, `Store      ${placeholder}`);
}

async function runJsonDiagnosis(caseName: string): Promise<DiagnosisJson> {
  const snapshotsDir = join(goldenRoot, caseName, 'snapshots');
  let out = '';
  let err = '';

  const context: MainContext = {
    argv: ['--snapshots', snapshotsDir, '--json', '--skip-gh'],
    env: {},
    streams: {
      writeOut: (text) => {
        out += text;
      },
      writeError: (text) => {
        err += text;
      },
    },
    now: () => GENERATED_AT,
    connect: () => {
      throw new Error('golden diagnosis must not open Redis');
    },
    openSnapshotStore: (directory) => createFileSnapshotStore(directory),
    readGhAuthToken: () => Promise.resolve(null),
  };

  const exitCode = await main(context);
  expect(err, err).toBe('');
  expect(exitCode).toBe(EXIT_CODES.ok);
  return JSON.parse(out) as DiagnosisJson;
}

async function runReport(caseName: string): Promise<DiagnosisReport> {
  const snapshotsDir = join(goldenRoot, caseName, 'snapshots');
  const listed = await createFileSnapshotStore(snapshotsDir).list();
  const snapshots = listed.map((entry) => entry.snapshot);
  return runDiagnosis({
    store: createMemorySnapshotStore(snapshots, storePlaceholder(caseName)),
    generatedAt: GENERATED_AT.toISOString(),
    target: null,
    sampleSize: null,
    timeoutMs: null,
    memorySamples: null,
    databases: null,
    redactKeys: false,
  });
}

describe('CLI golden diagnosis', () => {
  it('lists the expected cases on disk', () => {
    expect(readdirSync(goldenRoot).sort()).toEqual([...CASES].sort());
  });

  for (const caseName of CASES) {
    it(`${caseName}: main --snapshots --json --skip-gh matches expected`, async () => {
      const actual = await runJsonDiagnosis(caseName);
      const expected = loadExpected(caseName);
      expect(stripVolatile(actual)).toEqual(stripVolatile(expected));
    });

    it(`${caseName}: text and markdown match expected (store path normalised)`, async () => {
      const report = await runReport(caseName);
      const text = normalizeProse(renderTextDiagnosis(report), caseName);
      const markdown = normalizeProse(renderMarkdownDiagnosis(report), caseName);

      expect(text).toBe(normalizeProse(loadExpectedText(caseName), caseName));
      expect(markdown).toBe(normalizeProse(loadExpectedMarkdown(caseName), caseName));
      expect(text).not.toMatch(/\/Users\//);
      expect(text).not.toMatch(/\/home\//);
      expect(markdown).not.toMatch(/\/Users\//);
      expect(markdown).not.toMatch(/\/home\//);
    });
  }
});
