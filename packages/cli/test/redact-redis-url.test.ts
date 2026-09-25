import { describe, expect, it } from 'vitest';

import { redactRedisUrl } from '@redis-detective/cli';

describe('redactRedisUrl', () => {
  it('removes the password', () => {
    const redacted = redactRedisUrl('redis://admin:sup3rs3cret@cache.internal:6379/0');

    expect(redacted).not.toContain('sup3rs3cret');
    expect(redacted).toContain('***');
    expect(redacted).toContain('cache.internal:6379');
  });

  it('keeps the username, which identifies the ACL user and is not a secret', () => {
    expect(redactRedisUrl('redis://readonly:pw@host:6379')).toContain('readonly');
  });

  it('leaves credential-free URLs alone', () => {
    expect(redactRedisUrl('redis://localhost:6379')).toBe('redis://localhost:6379');
  });

  it('handles rediss:// and a database path', () => {
    const redacted = redactRedisUrl('rediss://user:pw@host:6380/3');

    expect(redacted).toContain('rediss://');
    expect(redacted).toContain('/3');
    expect(redacted).not.toContain('pw@');
  });

  it('returns a placeholder rather than echoing something it cannot parse', () => {
    expect(redactRedisUrl('not a url')).toBe('<unparseable redis url>');
    expect(redactRedisUrl('')).toBe('<unparseable redis url>');
  });
});
