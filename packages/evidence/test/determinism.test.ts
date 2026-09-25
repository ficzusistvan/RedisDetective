import { describe, expect, it } from 'vitest';

import { createEvidenceId, sortSnapshotsChronologically } from '@redis-detective/evidence';
import { SnapshotOrderingError } from '@redis-detective/evidence';

import { snapshotFixture } from './helpers/snapshot-fixture.js';

describe('createEvidenceId', () => {
  it('is stable across calls, so citations stay reproducible', () => {
    const first = createEvidenceId('anomaly', ['used_memory', '2026-08-25T10:00:00.000Z']);
    const second = createEvidenceId('anomaly', ['used_memory', '2026-08-25T10:00:00.000Z']);

    expect(first).toBe(second);
  });

  it('distinguishes different facts', () => {
    const left = createEvidenceId('anomaly', ['used_memory']);
    const right = createEvidenceId('anomaly', ['key_count']);

    expect(left).not.toBe(right);
  });

  it('encodes the kind and a readable label', () => {
    expect(createEvidenceId('ttl-drift', ['session:*'])).toMatch(/^ttl-drift-session-[0-9a-f]{8}$/);
  });

  it('handles an empty parts list', () => {
    expect(createEvidenceId('graph', [])).toMatch(/^graph-unknown-[0-9a-f]{8}$/);
  });
});

describe('sortSnapshotsChronologically', () => {
  it('orders oldest first without mutating the input', () => {
    const input = [
      snapshotFixture({ snapshotId: 'b', capturedAt: '2026-08-25T12:00:00.000Z' }),
      snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' }),
    ];

    const sorted = sortSnapshotsChronologically(input);

    expect(sorted.map((snapshot) => snapshot.snapshotId)).toEqual(['a', 'b']);
    expect(input.map((snapshot) => snapshot.snapshotId)).toEqual(['b', 'a']);
  });

  it('breaks timestamp ties on snapshotId for a stable order', () => {
    const sorted = sortSnapshotsChronologically([
      snapshotFixture({ snapshotId: 'z', capturedAt: '2026-08-25T10:00:00.000Z' }),
      snapshotFixture({ snapshotId: 'a', capturedAt: '2026-08-25T10:00:00.000Z' }),
    ]);

    expect(sorted.map((snapshot) => snapshot.snapshotId)).toEqual(['a', 'z']);
  });

  it('handles empty and single-element input', () => {
    expect(sortSnapshotsChronologically([])).toEqual([]);
    expect(sortSnapshotsChronologically([snapshotFixture()])).toHaveLength(1);
  });

  it('refuses to guess at an unparseable timestamp', () => {
    expect(() =>
      sortSnapshotsChronologically([snapshotFixture({ capturedAt: 'yesterday' })]),
    ).toThrow(SnapshotOrderingError);
  });
});
