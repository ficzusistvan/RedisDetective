import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  SNAPSHOT_FILE_SCHEMA_VERSION,
  StoredSnapshotError,
  parseStoredSnapshot,
  serializeSnapshot,
} from '@redis-detective/core';

import { snapshotFixture } from './helpers/snapshot-builder.js';

const require = createRequire(import.meta.url);
// ajv's published typings disagree with NodeNext + verbatimModuleSyntax default imports; require
// keeps the schema oracle test focused on fixture agreement rather than interop trivia.
const { Ajv2020 } = require('ajv/dist/2020.js') as {
  Ajv2020: new (options?: { allErrors?: boolean; strict?: boolean }) => {
    compile(schema: object): ((data: unknown) => boolean) & { errors: unknown };
  };
};

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(
  readFileSync(join(packageRoot, 'snapshot-file.schema.json'), 'utf8'),
) as object;
const goldenRoot = join(packageRoot, 'fixtures', 'golden');

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

describe('snapshot-file.schema.json', () => {
  it('accepts every golden version-1 fixture that parseStoredSnapshot accepts', () => {
    for (const caseName of readdirSync(goldenRoot)) {
      const snapsDir = join(goldenRoot, caseName, 'snapshots');
      for (const name of readdirSync(snapsDir).filter((entry) => entry.endsWith('.snapshot.json'))) {
        const location = join(snapsDir, name);
        const contents = JSON.parse(readFileSync(location, 'utf8')) as unknown;
        expect(parseStoredSnapshot(contents, location).snapshotId.length).toBeGreaterThan(0);
        expect(validate(contents), JSON.stringify(validate.errors)).toBe(true);
      }
    }
  });

  it('rejects schemaVersion 2 as a newer redis-detective file', () => {
    expect(() =>
      parseStoredSnapshot(
        { schemaVersion: 2, snapshot: serializeSnapshot(snapshotFixture()) },
        'future.snapshot.json',
      ),
    ).toThrow(/newer redis-detective/);
  });

  it('rejects junk schemaVersion the same way as a missing integer', () => {
    expect(() =>
      parseStoredSnapshot(
        { schemaVersion: 'nope', snapshot: serializeSnapshot(snapshotFixture()) },
        'junk.snapshot.json',
      ),
    ).toThrow(StoredSnapshotError);
    expect(() =>
      parseStoredSnapshot(
        { schemaVersion: 'nope', snapshot: serializeSnapshot(snapshotFixture()) },
        'junk.snapshot.json',
      ),
    ).toThrow(/schemaVersion/);
  });

  it('documents the current write version as 1', () => {
    expect(SNAPSHOT_FILE_SCHEMA_VERSION).toBe(1);
  });
});
