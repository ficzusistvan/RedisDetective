import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads this package's version from the nearest `package.json`.
 *
 * Layouts this has to survive:
 * - `src/` and `dist/` during development (`../package.json`)
 * - the published bundle (`./package.json` next to `bin.js` in `node_modules/redis-detective`)
 *
 * Same-directory is tried first so a parent `node_modules/package.json` cannot win after install.
 */
export function readCliVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'package.json'), join(here, '..', 'package.json')];

  for (const candidate of candidates) {
    const version = tryReadVersion(candidate);
    if (version !== null) {
      return version;
    }
  }

  throw new Error('Could not determine redis-detective version from package.json.');
}

function tryReadVersion(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  if (!isVersionedPackage(parsed)) {
    return null;
  }
  return parsed.version;
}

function isVersionedPackage(value: unknown): value is { readonly version: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('version' in value)) {
    return false;
  }
  const version = value.version;
  return typeof version === 'string' && version !== '';
}
