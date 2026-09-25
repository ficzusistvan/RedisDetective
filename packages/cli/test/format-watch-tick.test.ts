import { describe, expect, it } from 'vitest';

import { formatWatchTick } from '@redis-detective/cli';
import type { WatchTick } from '@redis-detective/cli';

function tick(overrides: Partial<WatchTick> = {}): WatchTick {
  return {
    at: '2026-08-25T10:00:00.000Z',
    sampledKeys: 1_000,
    usedMemoryBytes: 104_857_600,
    snapshotCount: 4,
    causePattern: null,
    ...overrides,
  };
}

describe('formatWatchTick', () => {
  it('fits the timestamp, the sample size and the memory figure on one line', () => {
    const line = formatWatchTick(tick({ causePattern: 'cart:items:*' }));

    expect(line).toBe(
      '2026-08-25T10:00:00.000Z  1,000 keys sampled  100.0 MB used  cause: cart:items:*',
    );
    expect(line).not.toContain('\n');
  });

  it('reports a shortage of snapshots as that, not as an absence of a cause', () => {
    expect(formatWatchTick(tick({ snapshotCount: 1 }))).toContain(
      '1 snapshot so far, nothing to compare yet',
    );
  });

  it('calls a diffed series with no attribution what it is', () => {
    expect(formatWatchTick(tick({ snapshotCount: 2, causePattern: null }))).toContain(
      'no named cause',
    );
  });
});
