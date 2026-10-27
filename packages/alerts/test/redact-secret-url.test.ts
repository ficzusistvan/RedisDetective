import { describe, expect, it } from 'vitest';

import { redactSecretUrl, redactSecretValue } from '@redis-detective/alerts';

describe('redactSecretUrl', () => {
  it('strips a Redis password', () => {
    expect(redactSecretUrl('redis://:super-secret@prod.example:6379/0')).toBe(
      'redis://:***@prod.example:6379/0',
    );
  });

  it('strips a Slack incoming-webhook path', () => {
    const redacted = redactSecretUrl(
      'https://hooks.slack.com/services/T00000000/B00000000/xxxxxxxx',
    );
    expect(redacted).toBe('https://hooks.slack.com/services/***');
    expect(redacted).not.toContain('T00000000');
  });

  it('strips query tokens', () => {
    const redacted = redactSecretUrl('https://hooks.example.com/notify?token=abc&keep=1');
    expect(redacted).toContain('token=***');
    expect(redacted).not.toContain('token=abc');
  });

  it('replaces unparseable input rather than echoing it', () => {
    expect(redactSecretUrl('not a url /services/T000/secret')).toBe('<redacted-url>');
  });
});

describe('redactSecretValue', () => {
  it('never returns a prefix of the secret', () => {
    expect(redactSecretValue('R02XXXXROUTINGKEY')).toBe('***');
    expect(redactSecretValue('')).toBe('');
  });
});
