import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXIT_CODES, createFileSnapshotStore, main } from '@redis-detective/cli';
import type { DiagnosisJson, MainContext } from '@redis-detective/cli';

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

function loadExpected(caseName: string): DiagnosisJson {
  return JSON.parse(
    readFileSync(join(goldenRoot, caseName, 'expected.diagnosis.json'), 'utf8'),
  ) as DiagnosisJson;
}

function stripVolatile(diagnosis: DiagnosisJson): Omit<
  DiagnosisJson,
  'storeLocation' | 'target' | 'savedLocation'
> {
  const { storeLocation: _s, target: _t, savedLocation: _l, ...rest } = diagnosis;
  return rest;
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
  }
});
