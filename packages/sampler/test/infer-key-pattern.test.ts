import { describe, expect, it } from 'vitest';

import { inferKeyPattern, isHighCardinalitySegment } from '@redis-detective/sampler';

describe('isHighCardinalitySegment', () => {
  it('recognises generated identifiers', () => {
    expect(isHighCardinalitySegment('42')).toBe(true);
    expect(isHighCardinalitySegment('8f2a1c')).toBe(true);
    expect(isHighCardinalitySegment('8f2a1c9b')).toBe(true);
    expect(isHighCardinalitySegment('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(isHighCardinalitySegment('01H8XGJWBWBAQ4Z2K9F7')).toBe(true);
    expect(isHighCardinalitySegment('user1234567')).toBe(true);
  });

  it('leaves names written by a human alone', () => {
    expect(isHighCardinalitySegment('session')).toBe(false);
    expect(isHighCardinalitySegment('cart')).toBe(false);
    expect(isHighCardinalitySegment('subscriptions')).toBe(false);
    expect(isHighCardinalitySegment('')).toBe(false);
  });

  // Without the digit requirement, ordinary words made of hex letters would be collapsed.
  it('does not treat hex-lettered words as digests', () => {
    expect(isHighCardinalitySegment('feedface')).toBe(false);
    expect(isHighCardinalitySegment('deadbeef')).toBe(false);
    expect(isHighCardinalitySegment('decade')).toBe(false);
  });

  // The four-digit floor on the name+id rule exists to protect these.
  it('keeps common technical names intact', () => {
    for (const name of ['sha256', 'base64', 'h264', 'utf8', 'x86', 'md5', 'db1', 'v2', 'oauth2']) {
      expect(isHighCardinalitySegment(name), name).toBe(false);
    }
  });
});

describe('inferKeyPattern', () => {
  it('collapses the tail beyond the depth budget', () => {
    expect(inferKeyPattern('session:user:8f2a1c', 2)).toBe('session:user:*');
    expect(inferKeyPattern('a:b:c:d', 2)).toBe('a:b:*');
  });

  it('collapses an identifier without spending the depth budget', () => {
    expect(inferKeyPattern('user:8f2a1c:cart', 2)).toBe('user:*:cart');
  });

  it('collapses consecutive wildcards into one', () => {
    expect(inferKeyPattern('user:8f2a1c:9b3d2e:cart', 2)).toBe('user:*:cart');
  });

  it('groups sibling keys onto the same pattern', () => {
    const patterns = new Set(
      ['session:8f2a1c', 'session:0b91de', 'session:77c3aa'].map((key) => inferKeyPattern(key, 2)),
    );

    expect([...patterns]).toEqual(['session:*']);
  });

  it('supports non-colon separators, preferring colon when both appear', () => {
    expect(inferKeyPattern('cache/products/42', 2)).toBe('cache/products/*');
    expect(inferKeyPattern('queue|jobs|9001', 2)).toBe('queue|jobs|*');
    expect(inferKeyPattern('a:b/c', 1)).toBe('a:*');
  });

  it('handles single-segment keys', () => {
    expect(inferKeyPattern('config', 2)).toBe('config');
    expect(inferKeyPattern('12345', 2)).toBe('*');
  });

  it('respects the depth argument', () => {
    expect(inferKeyPattern('a:b:c:d', 1)).toBe('a:*');
    expect(inferKeyPattern('a:b:c:d', 3)).toBe('a:b:c:*');
    expect(inferKeyPattern('a:b:c:d', 8)).toBe('a:b:c:d');
  });

  it('is deterministic', () => {
    expect(inferKeyPattern('session:user:8f2a1c', 2)).toBe(
      inferKeyPattern('session:user:8f2a1c', 2),
    );
  });
});
