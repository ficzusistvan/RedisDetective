import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatCount,
  formatDuration,
  formatEstimatedBytes,
  formatPercent,
} from '@redis-detective/cli';

describe('formatBytes', () => {
  it('uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_024)).toBe('1.0 KB');
    expect(formatBytes(1_536)).toBe('1.5 KB');
    expect(formatBytes(4_194_304)).toBe('4.0 MB');
    expect(formatBytes(2 * 1_024 ** 3)).toBe('2.0 GB');
  });

  it('prints whole bytes without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
  });

  it('handles negative, missing, and non-finite input', () => {
    expect(formatBytes(-2_048)).toBe('-2.0 KB');
    expect(formatBytes(null)).toBe('unknown');
    expect(formatBytes(Number.NaN)).toBe('unknown');
  });
});

describe('formatEstimatedBytes', () => {
  // The report must never let an extrapolation be quoted as a measurement.
  it('marks an extrapolation and leaves a measurement bare', () => {
    expect(formatEstimatedBytes(2_048, true)).toBe('~2.0 KB est.');
    expect(formatEstimatedBytes(2_048, false)).toBe('2.0 KB');
  });
});

describe('formatCount', () => {
  it('groups digits and marks estimates', () => {
    expect(formatCount(1_234_567, false)).toBe('1,234,567');
    expect(formatCount(1_234, true)).toBe('~1,234');
  });
});

describe('formatPercent', () => {
  it('renders a fraction to one decimal', () => {
    expect(formatPercent(0.875)).toBe('87.5%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(1)).toBe('100.0%');
  });
});

describe('formatDuration', () => {
  it('picks the largest readable unit', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(7_200)).toBe('2.0h');
    expect(formatDuration(172_800)).toBe('2.0d');
  });

  // A column showing "60m" next to "2.0h" reads as an inconsistency.
  it('promotes a unit once rounding fills it', () => {
    expect(formatDuration(3_599)).toBe('1.0h');
    expect(formatDuration(59.6)).toBe('1m');
  });
});
