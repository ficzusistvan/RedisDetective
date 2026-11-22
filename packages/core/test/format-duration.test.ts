import { describe, expect, it } from 'vitest';

import { formatDuration } from '@redis-detective/core';

describe('formatDuration', () => {
  it('renders seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(1_000)).toBe('1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(59_499)).toBe('59 s');
  });

  it('renders whole minutes under an hour', () => {
    expect(formatDuration(60_000)).toBe('1 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(59 * 60_000)).toBe('59 min');
  });

  it('renders hours, with leftover minutes when needed', () => {
    expect(formatDuration(60 * 60_000)).toBe('1 h');
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min');
    expect(formatDuration(6 * 60 * 60_000)).toBe('6 h');
    expect(formatDuration(9 * 60 * 60_000)).toBe('9 h');
  });

  it('renders days, with leftover hours when needed', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('1 d');
    expect(formatDuration(30 * 60 * 60_000)).toBe('1 d 6 h');
    expect(formatDuration(48 * 60 * 60_000)).toBe('2 d');
  });

  it('handles edge values', () => {
    expect(formatDuration(-45_000)).toBe('-45 s');
    expect(formatDuration(-90 * 60_000)).toBe('-1 h 30 min');
    expect(formatDuration(Number.NaN)).toBe('unknown');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('unknown');
    expect(formatDuration(59_500)).toBe('1 min');
  });
});
