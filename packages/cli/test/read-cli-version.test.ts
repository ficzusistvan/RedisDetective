import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CLI_VERSION, readCliVersion } from '@redis-detective/cli';

describe('readCliVersion', () => {
  it('matches packages/cli/package.json so --version cannot drift', () => {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      typeof parsed.version !== 'string'
    ) {
      throw new Error('packages/cli/package.json is missing a version string.');
    }

    expect(readCliVersion()).toBe(parsed.version);
    expect(CLI_VERSION).toBe(parsed.version);
  });
});
