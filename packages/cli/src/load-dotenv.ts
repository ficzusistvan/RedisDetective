import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface LoadDotenvRequest {
  readonly cwd: string;
  /**
   * Mutated in place. Keys already present are left alone, so a shell export always wins over
   * `.env` — the same rule dotenv uses, and the one CI relies on.
   */
  readonly env: { [key: string]: string | undefined };
  /** Injected so tests do not read a real `.env` (which may contain secrets). */
  readonly readFile?: (path: string) => string;
  readonly exists?: (path: string) => boolean;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseDotenv(contents: string): Readonly<Record<string, string>> {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const line = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed;
    const separator = line.indexOf('=');
    if (separator < 1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!KEY.test(key)) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    const doubleQuoted = value.startsWith('"') && value.endsWith('"') && value.length >= 2;
    const singleQuoted = value.startsWith("'") && value.endsWith("'") && value.length >= 2;
    if (doubleQuoted || singleQuoted) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(' #');
      if (comment >= 0) {
        value = value.slice(0, comment).trim();
      }
    }

    parsed[key] = value;
  }

  return parsed;
}

function findDotenvPath(cwd: string, exists: (path: string) => boolean): string | null {
  let directory = cwd;
  for (;;) {
    const candidate = join(directory, '.env');
    if (exists(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

/**
 * Loads `KEY=value` pairs from a `.env` file in `cwd` or a parent directory.
 *
 * Node does not read `.env` on its own. This is the CLI's job, and it happens only in `bin.ts`
 * so tests that inject `env` into `main` never pick up a developer's secrets.
 *
 * Missing file is a no-op: the health check must still work with no file at all.
 */
export function loadDotenv(request: LoadDotenvRequest): string | null {
  const exists = request.exists ?? existsSync;
  const readFile = request.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const path = findDotenvPath(request.cwd, exists);
  if (path === null) {
    return null;
  }

  const parsed = parseDotenv(readFile(path));
  for (const [key, value] of Object.entries(parsed)) {
    if (request.env[key] === undefined) {
      request.env[key] = value;
    }
  }

  return path;
}
