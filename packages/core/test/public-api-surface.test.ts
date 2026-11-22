import { describe, expect, it } from 'vitest';

import * as core from '@redis-detective/core';

const REQUIRED_VALUES = [
  'SNAPSHOT_FILE_SCHEMA_VERSION',
  'SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS',
  'DIAGNOSIS_REPORT_SCHEMA_VERSION',
  'DIAGNOSIS_REPORT_TYPE',
  'EVIDENCE_DEFAULTS',
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
] as const;

describe('public API surface', () => {
  it('exports every documented runtime symbol', () => {
    for (const name of REQUIRED_VALUES) {
      expect(core, name).toHaveProperty(name);
      expect((core as Record<string, unknown>)[name], name).not.toBeUndefined();
    }
  });

  it('keeps SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS including the current version', () => {
    expect(core.SUPPORTED_SNAPSHOT_FILE_SCHEMA_VERSIONS).toContain(
      core.SNAPSHOT_FILE_SCHEMA_VERSION,
    );
  });
});
