import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const PUSH_STATE_SCHEMA_VERSION = 1;

export interface AcceptedSnapshot {
  readonly snapshotId: string;
  readonly name: string;
  readonly capturedAt: string;
  readonly acceptedAt: string;
}

/** Snapshots one web instance has already accepted. Keyed by origin + instance, not by token. */
export interface PushTargetRecord {
  readonly webUrl: string;
  readonly instanceId: string;
  readonly accepted: readonly AcceptedSnapshot[];
}

export interface PushState {
  readonly targets: readonly PushTargetRecord[];
}

/**
 * Remembers which snapshot ids a web instance accepted, so a later push does not send them again.
 *
 * A missing file is empty state. A file that cannot be parsed throws `PushStateError` rather than
 * looking empty: treating it as empty would upload the whole directory and recreate the payload
 * limit this state exists to avoid.
 */
export interface PushStateStore {
  readonly describe: string;
  load(): Promise<PushState>;
  save(state: PushState): Promise<void>;
}

export class PushStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushStateError';
  }
}

export function emptyPushState(): PushState {
  return { targets: [] };
}

/** Trailing slashes are not part of the origin identity. The host is left as the user typed it. */
export function normalizeWebUrl(webUrl: string): string {
  return webUrl.replace(/\/+$/, '');
}

export function createFilePushStateStore(filePath: string): PushStateStore {
  return {
    describe: filePath,

    async load(): Promise<PushState> {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (error: unknown) {
        if (isEnoent(error)) {
          return emptyPushState();
        }
        throw error;
      }
      return parsePushState(raw);
    },

    async save(state: PushState): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      const body = `${JSON.stringify(
        { schemaVersion: PUSH_STATE_SCHEMA_VERSION, targets: state.targets },
        null,
        2,
      )}\n`;
      const tempPath = join(
        dirname(filePath),
        `.${process.pid.toString(16)}-${randomBytes(4).toString('hex')}.push.tmp`,
      );
      await writeFile(tempPath, body, 'utf8');
      try {
        await rename(tempPath, filePath);
      } catch (error: unknown) {
        await rm(tempPath, { force: true });
        throw error;
      }
    },
  };
}

/** In-memory store for tests. Same contract as the file, no disk. */
export function createMemoryPushStateStore(initial: PushState = emptyPushState()): PushStateStore {
  let state = initial;
  return {
    describe: 'memory',
    load(): Promise<PushState> {
      return Promise.resolve(state);
    },
    save(next: PushState): Promise<void> {
      state = next;
      return Promise.resolve();
    },
  };
}

export function parsePushState(raw: string): PushState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new PushStateError('Push state file is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new PushStateError('Push state file must be an object.');
  }
  if (parsed['schemaVersion'] !== PUSH_STATE_SCHEMA_VERSION) {
    throw new PushStateError(
      `Push state file has schemaVersion ${String(parsed['schemaVersion'])}; this CLI reads ${String(PUSH_STATE_SCHEMA_VERSION)}.`,
    );
  }
  const targets = parsed['targets'];
  if (!Array.isArray(targets)) {
    throw new PushStateError('Push state file is missing a targets array.');
  }
  return { targets: targets.map((entry, index) => parseTarget(entry, index)) };
}

function parseTarget(value: unknown, index: number): PushTargetRecord {
  if (!isRecord(value)) {
    throw new PushStateError(`Push state target ${String(index)} is not an object.`);
  }
  const webUrl = value['webUrl'];
  const instanceId = value['instanceId'];
  const accepted = value['accepted'];
  if (
    typeof webUrl !== 'string' ||
    webUrl === '' ||
    typeof instanceId !== 'string' ||
    instanceId === ''
  ) {
    throw new PushStateError(
      `Push state target ${String(index)} is missing a web URL or instance id.`,
    );
  }
  if (!Array.isArray(accepted)) {
    throw new PushStateError(`Push state target ${String(index)} is missing an accepted array.`);
  }
  return {
    webUrl,
    instanceId,
    accepted: accepted.map((entry, acceptedIndex) => parseAccepted(entry, index, acceptedIndex)),
  };
}

function parseAccepted(value: unknown, targetIndex: number, index: number): AcceptedSnapshot {
  if (!isRecord(value)) {
    throw new PushStateError(
      `Push state target ${String(targetIndex)} accepted entry ${String(index)} is not an object.`,
    );
  }
  return {
    snapshotId: requiredString(value, 'snapshotId', targetIndex, index),
    name: requiredString(value, 'name', targetIndex, index),
    capturedAt: requiredString(value, 'capturedAt', targetIndex, index),
    acceptedAt: requiredString(value, 'acceptedAt', targetIndex, index),
  };
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  targetIndex: number,
  index: number,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new PushStateError(
      `Push state target ${String(targetIndex)} accepted entry ${String(index)} is missing ${key}.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}
