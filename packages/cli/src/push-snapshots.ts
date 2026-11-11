import { SNAPSHOT_FILE_SCHEMA_VERSION } from './parse-stored-snapshot.js';
import { serializeSnapshot } from './serialize-snapshot.js';
import { snapshotFileName } from './snapshot-store.js';
import type { SnapshotStore, StoredSnapshot } from './snapshot-store.js';

export interface PushTarget {
  /** Origin of the web app, e.g. `https://app.example.com` (no trailing slash required). */
  readonly webUrl: string;
  readonly instanceId: string;
  readonly token: string;
}

export interface SnapshotUploadFile {
  readonly name: string;
  readonly contents: string;
}

export type PushResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: number | null; readonly message: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Rebuilds the on-disk snapshot JSON shape from a store entry. */
export function uploadFilesFromStore(entries: readonly StoredSnapshot[]): readonly SnapshotUploadFile[] {
  return entries.map((entry) => ({
    name: snapshotFileName(entry.snapshot),
    contents: `${JSON.stringify(
      {
        schemaVersion: SNAPSHOT_FILE_SCHEMA_VERSION,
        snapshot: serializeSnapshot(entry.snapshot),
      },
      null,
      2,
    )}\n`,
  }));
}

export async function uploadFilesFromSnapshotStore(
  store: SnapshotStore,
): Promise<readonly SnapshotUploadFile[]> {
  return uploadFilesFromStore(await store.list());
}

/**
 * POSTs `*.snapshot.json` files to the web app's machine upload endpoint.
 * A 409 means a run is already in progress; callers decide whether that is fatal.
 */
export async function pushSnapshotsToWeb(
  target: PushTarget,
  files: readonly SnapshotUploadFile[],
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<PushResult> {
  if (files.length === 0) {
    return { ok: false, status: null, message: 'No .snapshot.json files to push.' };
  }
  const base = target.webUrl.replace(/\/$/, '');
  const form = new FormData();
  for (const file of files) {
    form.append('snapshots', new File([file.contents], file.name, { type: 'application/json' }));
  }
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/instances/${encodeURIComponent(target.instanceId)}/snapshots`, {
      method: 'POST',
      headers: { authorization: `Bearer ${target.token}` },
      body: form,
    });
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message !== '' ? error.message : 'network error';
    return { ok: false, status: null, message: `Could not reach the web app (${detail}).` };
  }
  if (response.status === 202) {
    return { ok: true };
  }
  const body = (await response.text()).trim();
  return {
    ok: false,
    status: response.status,
    message: body === '' ? `Web app returned HTTP ${String(response.status)}.` : body,
  };
}
