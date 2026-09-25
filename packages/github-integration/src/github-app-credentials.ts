import { readFileSync } from 'node:fs';

/**
 * GitHub **App** credentials for the preferred org auth path.
 *
 * A GitHub App installation gives per-repository, least-privilege, revocable access with a
 * short-lived installation token, and it is auditable by the org that installed it. When App
 * environment is incomplete, the CLI may fall back to a personal token or `gh auth token` — see
 * ADR 0002. The private key never appears in code or in a committed file.
 */
export interface GitHubAppCredentials {
  readonly appId: string;
  readonly installationId: string;
  /** PEM contents, held only as long as needed to sign a JWT. Never logged. */
  readonly privateKeyPem: string;
}

export const GITHUB_APP_ENV_VARS = {
  appId: 'GITHUB_APP_ID',
  installationId: 'GITHUB_APP_INSTALLATION_ID',
  privateKeyPath: 'GITHUB_APP_PRIVATE_KEY_PATH',
  privateKeyBase64: 'GITHUB_APP_PRIVATE_KEY_BASE64',
} as const;

/** Personal-token env names consulted only when App env is incomplete (CLI discovery order). */
export const GITHUB_PERSONAL_TOKEN_ENV_VARS = {
  githubToken: 'GITHUB_TOKEN',
  ghToken: 'GH_TOKEN',
} as const;

export class GitHubAuthConfigError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'GitHubAuthConfigError';
  }
}

export interface LoadGitHubAppCredentialsDeps {
  /** Injected so tests do not have to write a real PEM to disk. */
  readonly readFile?: (path: string) => string;
}

function readEnv(env: Readonly<Record<string, string | undefined>>, name: string): string | null {
  const value = env[name];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * True when App id, installation id, and exactly one private-key source are set.
 * Does not read or validate the PEM — that happens in `loadGitHubAppCredentialsFromEnv`.
 */
export function isGitHubAppEnvComplete(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (readEnv(env, GITHUB_APP_ENV_VARS.appId) === null) {
    return false;
  }
  if (readEnv(env, GITHUB_APP_ENV_VARS.installationId) === null) {
    return false;
  }
  const path = readEnv(env, GITHUB_APP_ENV_VARS.privateKeyPath);
  const base64 = readEnv(env, GITHUB_APP_ENV_VARS.privateKeyBase64);
  return (path !== null) !== (base64 !== null);
}

function readPrivateKey(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
): string {
  const path = readEnv(env, GITHUB_APP_ENV_VARS.privateKeyPath);
  const base64 = readEnv(env, GITHUB_APP_ENV_VARS.privateKeyBase64);

  if (path !== null && base64 !== null) {
    throw new GitHubAuthConfigError(
      `Set exactly one of ${GITHUB_APP_ENV_VARS.privateKeyPath} or ${GITHUB_APP_ENV_VARS.privateKeyBase64}, not both. An ambiguous key source makes a credential rotation impossible to debug.`,
    );
  }
  if (path === null && base64 === null) {
    throw new GitHubAuthConfigError(
      `A GitHub App private key is required. Set ${GITHUB_APP_ENV_VARS.privateKeyPath} to a .pem file, or ${GITHUB_APP_ENV_VARS.privateKeyBase64} to the base64-encoded PEM.`,
    );
  }

  let pem: string;
  if (path !== null) {
    try {
      pem = readFile(path);
    } catch (error) {
      throw new GitHubAuthConfigError(
        `Could not read the GitHub App private key at ${GITHUB_APP_ENV_VARS.privateKeyPath}.`,
        { cause: error },
      );
    }
  } else {
    try {
      pem = Buffer.from(base64 ?? '', 'base64').toString('utf8');
    } catch (error) {
      throw new GitHubAuthConfigError(
        `Could not decode ${GITHUB_APP_ENV_VARS.privateKeyBase64} as base64.`,
        { cause: error },
      );
    }
  }

  if (!pem.includes('BEGIN') || !pem.includes('PRIVATE KEY')) {
    throw new GitHubAuthConfigError(
      'The GitHub App private key is not a PEM. The value is not included in this message on purpose.',
    );
  }

  return pem;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Loads App credentials from the environment.
 *
 * Reads `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID`, then the key from exactly one of
 * `GITHUB_APP_PRIVATE_KEY_PATH` (read the file) or `GITHUB_APP_PRIVATE_KEY_BASE64` (decode).
 * Neither-or-both is a configuration bug, and picking one silently would make a credential
 * rotation impossible to debug. The error message never includes any part of the key.
 */
export function loadGitHubAppCredentialsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  deps: LoadGitHubAppCredentialsDeps = {},
): GitHubAppCredentials {
  const appId = readEnv(env, GITHUB_APP_ENV_VARS.appId);
  const installationId = readEnv(env, GITHUB_APP_ENV_VARS.installationId);

  if (appId === null) {
    throw new GitHubAuthConfigError(`${GITHUB_APP_ENV_VARS.appId} is not set.`);
  }
  if (installationId === null) {
    throw new GitHubAuthConfigError(`${GITHUB_APP_ENV_VARS.installationId} is not set.`);
  }

  return {
    appId,
    installationId,
    privateKeyPem: readPrivateKey(env, deps.readFile ?? defaultReadFile),
  };
}
