import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  diagnoseSnapshots,
  parseStoredSnapshot,
} from '@redis-detective/core';
import type { DiagnosisJson, RedisSnapshot } from '@redis-detective/core';

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');
const GENERATED_AT = '2026-08-25T14:00:00.000Z';
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const CASES = [
  'flat-no-growth',
  'single-snapshot',
  'below-threshold-growth',
  'clear-leak',
  'ttl-drift',
  'snapshot-gap',
] as const;

function loadSnapshots(caseName: string): readonly RedisSnapshot[] {
  const dir = join(goldenRoot, caseName, 'snapshots');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.snapshot.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const location = join(dir, name);
      return parseStoredSnapshot(JSON.parse(readFileSync(location, 'utf8')) as unknown, location);
    });
}

function loadExpected(caseName: string): DiagnosisJson {
  return JSON.parse(
    readFileSync(join(goldenRoot, caseName, 'expected.diagnosis.json'), 'utf8'),
  ) as DiagnosisJson;
}

function normalize(diagnosis: DiagnosisJson, caseName: string): DiagnosisJson {
  return {
    ...diagnosis,
    storeLocation: `<golden>/${caseName}`,
    target: null,
    savedLocation: null,
  };
}

describe('diagnoseSnapshots golden fixtures', () => {
  for (const caseName of CASES) {
    it(`${caseName} matches expected.diagnosis.json`, async () => {
      const actual = normalize(
        await diagnoseSnapshots({
          snapshots: loadSnapshots(caseName),
          generatedAt: GENERATED_AT,
          storeLocation: `<golden>/${caseName}`,
          target: null,
        }),
        caseName,
      );

      if (UPDATE) {
        writeFileSync(
          join(goldenRoot, caseName, 'expected.diagnosis.json'),
          `${JSON.stringify(actual, null, 2)}\n`,
        );
      }

      expect(actual).toEqual(loadExpected(caseName));
    });
  }
});
