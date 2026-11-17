import { formatBytes, formatDuration } from './format-bytes.js';
import { estimateMultipartBodyBytes } from './estimate-upload-bytes.js';
import { packSnapshotBatches } from './pack-snapshot-batches.js';
import type { OversizedUploadFile } from './pack-snapshot-batches.js';
import { pushSnapshotsToWeb } from './push-snapshots.js';
import type { FetchLike, PushCandidate, PushTarget, SnapshotUploadFile } from './push-snapshots.js';
import type {
  AcceptedSnapshot,
  PushState,
  PushStateStore,
  PushTargetRecord,
} from './push-state-store.js';
import { normalizeWebUrl } from './push-state-store.js';

export interface RunSnapshotPushRequest {
  readonly target: PushTarget;
  readonly candidates: readonly PushCandidate[];
  readonly stateStore: PushStateStore;
  readonly maxBytes: number;
  /**
   * Skip snapshots whose `capturedAt` is older than this. `0` uploads every age.
   * Compared the same way the web app prunes: strictly older than `now - maxAgeMs` is dropped.
   */
  readonly maxAgeMs: number;
  /** Upload snapshots the state file already lists as accepted. Age filtering still applies. */
  readonly pushAll: boolean;
  readonly now: Date;
  readonly fetchImpl: FetchLike;
}

export interface SnapshotPushReport {
  /** True when nothing failed. An empty directory is a failure; "nothing new" is not. */
  readonly ok: boolean;
  /** Status of the first failed request, or `null` when the failure was not an HTTP response. */
  readonly status: number | null;
  readonly summary: string;
  readonly details: readonly string[];
  readonly pushed: number;
  readonly attempted: number;
  readonly failed: number;
  readonly skippedAlreadySent: number;
  readonly skippedTooOld: number;
}

interface BatchFailure {
  readonly status: number | null;
  readonly message: string;
}

/**
 * Sends the snapshots a web instance does not already have, in bodies that fit `maxBytes`.
 *
 * A batch is written into the state file only after HTTP 202. The hosted app stores each part
 * under its filename and overwrites that object, and the CLI filename is fixed by `capturedAt`
 * and `snapshotId`, so posting an unrecorded batch again replaces the same object. The app does
 * not look at `snapshotId`, so two different filenames carrying one id would both be kept; this
 * function will not invent that second name.
 */
export async function runSnapshotPush(
  request: RunSnapshotPushRequest,
): Promise<SnapshotPushReport> {
  const label = `${normalizeWebUrl(request.target.webUrl)} for instance ${request.target.instanceId}`;

  let state: PushState;
  try {
    state = await request.stateStore.load();
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message !== '' ? error.message : 'unknown error';
    return {
      ok: false,
      status: null,
      summary: `Could not read push state (${request.stateStore.describe}): ${detail}`,
      details: [],
      pushed: 0,
      attempted: 0,
      failed: 0,
      skippedAlreadySent: 0,
      skippedTooOld: 0,
    };
  }

  if (request.candidates.length === 0) {
    return {
      ok: false,
      status: null,
      summary: 'No .snapshot.json files to push.',
      details: [],
      pushed: 0,
      attempted: 0,
      failed: 0,
      skippedAlreadySent: 0,
      skippedTooOld: 0,
    };
  }

  const selected = selectCandidates(request, state);
  const files = selected.pending.map((candidate) => ({
    name: candidate.name,
    contents: candidate.contents,
  }));
  const packed = packSnapshotBatches(files, request.maxBytes);
  const pendingByName = new Map(selected.pending.map((candidate) => [candidate.name, candidate]));

  const failures: BatchFailure[] = [];
  let firstStatus: number | null = null;
  let pushed = 0;
  let posted = 0;

  for (const batch of packed.batches) {
    const attemptedBytes = estimateMultipartBodyBytes(batch);
    const result = await pushSnapshotsToWeb(request.target, batch, request.fetchImpl);
    posted += batch.length;
    if (result.ok) {
      const recorded = batch.flatMap((file) => {
        const candidate = pendingByName.get(file.name);
        return candidate === undefined ? [] : [acceptedRecord(candidate, request.now)];
      });
      pushed += recorded.length;
      state = withAccepted(state, request.target, recorded, request.now, request.maxAgeMs);
      const saved = await saveState(request.stateStore, state);
      if (saved !== null) {
        failures.push({ status: null, message: saved });
        break;
      }
      continue;
    }

    if (firstStatus === null) {
      firstStatus = result.status;
    }
    failures.push({
      status: result.status,
      message: batchFailureMessage(result.status, result.message, batch, attemptedBytes),
    });
  }

  const batchFileCount = packed.batches.reduce((sum, batch) => sum + batch.length, 0);
  const notPosted = batchFileCount - posted;
  const oversizedFailures = packed.oversized.map((file) =>
    oversizedMessage(file, request.maxBytes),
  );
  const unreadableFailures = selected.unreadable.map(
    (candidate) =>
      `${candidate.name} has no readable capturedAt, so it was not sent. The hosted app would drop it.`,
  );
  const failed = packed.oversized.length + unreadableFailures.length + (posted - pushed);
  const attempted = posted + packed.oversized.length + selected.unreadable.length;
  const details = [
    ...oversizedFailures,
    ...unreadableFailures,
    ...failures.map((failure) => failure.message),
    ...(notPosted > 0
      ? [`Stopped before ${countNoun(notPosted, 'snapshot')}; those files were not uploaded.`]
      : []),
  ];
  const ok = failed === 0 && failures.length === 0;

  return {
    ok,
    status: ok ? null : firstStatus,
    summary: summaryLine({
      label,
      pushed,
      attempted,
      failed,
      skippedAlreadySent: selected.alreadySent,
      skippedTooOld: selected.tooOld,
      maxAgeMs: request.maxAgeMs,
    }),
    details,
    pushed,
    attempted,
    failed,
    skippedAlreadySent: selected.alreadySent,
    skippedTooOld: selected.tooOld,
  };
}

interface Selection {
  readonly pending: readonly PushCandidate[];
  readonly unreadable: readonly PushCandidate[];
  readonly alreadySent: number;
  readonly tooOld: number;
}

function selectCandidates(request: RunSnapshotPushRequest, state: PushState): Selection {
  const acceptedIds = acceptedIdSet(state, request.target);
  const cutoff = request.now.getTime() - request.maxAgeMs;
  const pending: PushCandidate[] = [];
  const unreadable: PushCandidate[] = [];
  let alreadySent = 0;
  let tooOld = 0;

  for (const candidate of request.candidates) {
    const capturedAtMs = Date.parse(candidate.capturedAt);
    if (!Number.isFinite(capturedAtMs)) {
      unreadable.push(candidate);
      continue;
    }
    if (request.maxAgeMs > 0 && capturedAtMs < cutoff) {
      tooOld += 1;
      continue;
    }
    if (!request.pushAll && acceptedIds.has(candidate.snapshotId)) {
      alreadySent += 1;
      continue;
    }
    pending.push(candidate);
  }

  return { pending, unreadable, alreadySent, tooOld };
}

function acceptedIdSet(state: PushState, target: PushTarget): ReadonlySet<string> {
  const record = targetRecord(state, target);
  return new Set(record?.accepted.map((item) => item.snapshotId) ?? []);
}

function targetRecord(state: PushState, target: PushTarget): PushTargetRecord | undefined {
  const webUrl = normalizeWebUrl(target.webUrl);
  return state.targets.find(
    (item) => item.webUrl === webUrl && item.instanceId === target.instanceId,
  );
}

function acceptedRecord(candidate: PushCandidate, now: Date): AcceptedSnapshot {
  return {
    snapshotId: candidate.snapshotId,
    name: candidate.name,
    capturedAt: candidate.capturedAt,
    acceptedAt: now.toISOString(),
  };
}

function withAccepted(
  state: PushState,
  target: PushTarget,
  added: readonly AcceptedSnapshot[],
  now: Date,
  maxAgeMs: number,
): PushState {
  const webUrl = normalizeWebUrl(target.webUrl);
  const current = targetRecord(state, target);
  const byId = new Map<string, AcceptedSnapshot>();
  for (const item of current?.accepted ?? []) {
    byId.set(item.snapshotId, item);
  }
  for (const item of added) {
    byId.set(item.snapshotId, item);
  }
  const accepted = pruneAccepted([...byId.values()], now, maxAgeMs);
  const others = state.targets.filter(
    (item) => item.webUrl !== webUrl || item.instanceId !== target.instanceId,
  );
  return {
    targets: [...others, { webUrl, instanceId: target.instanceId, accepted }],
  };
}

function pruneAccepted(
  accepted: readonly AcceptedSnapshot[],
  now: Date,
  maxAgeMs: number,
): readonly AcceptedSnapshot[] {
  if (maxAgeMs <= 0) {
    return accepted;
  }
  const cutoff = now.getTime() - maxAgeMs;
  return accepted.filter((item) => {
    const capturedAtMs = Date.parse(item.capturedAt);
    return Number.isFinite(capturedAtMs) && capturedAtMs >= cutoff;
  });
}

async function saveState(store: PushStateStore, state: PushState): Promise<string | null> {
  try {
    await store.save(state);
    return null;
  } catch (error: unknown) {
    const detail = error instanceof Error && error.message !== '' ? error.message : 'unknown error';
    return `Uploaded snapshots could not be recorded in ${store.describe} (${detail}). The next push may send them again.`;
  }
}

function batchFailureMessage(
  status: number | null,
  serverMessage: string,
  batch: readonly SnapshotUploadFile[],
  attemptedBytes: number,
): string {
  const names = batch.map((file) => file.name).join(', ');
  if (status === 413) {
    const server =
      serverMessage === '' || serverMessage.startsWith('Web app returned HTTP')
        ? ''
        : ` Server said: ${serverMessage}`;
    return `Batch of ${countNoun(batch.length, 'snapshot')} was too large (HTTP 413). Attempted ${formatBytes(attemptedBytes)} (${String(attemptedBytes)} bytes): ${names}.${server}`;
  }
  const statusText = status === null ? 'no HTTP response' : `HTTP ${String(status)}`;
  return `Batch of ${countNoun(batch.length, 'snapshot')} failed (${statusText}): ${serverMessage} Files: ${names}.`;
}

function oversizedMessage(file: OversizedUploadFile, maxBytes: number): string {
  return `${file.name} would be ${formatBytes(file.bytes)} (${String(file.bytes)} bytes) with multipart overhead, above the ${formatBytes(maxBytes)} (${String(maxBytes)} byte) upload limit, so it was not sent.`;
}

function summaryLine(input: {
  readonly label: string;
  readonly pushed: number;
  readonly attempted: number;
  readonly failed: number;
  readonly skippedAlreadySent: number;
  readonly skippedTooOld: number;
  readonly maxAgeMs: number;
}): string {
  if (input.attempted === 0) {
    return nothingNewLine(
      input.label,
      input.skippedAlreadySent,
      input.skippedTooOld,
      input.maxAgeMs,
    );
  }
  const skipped = skipSuffix(input.skippedAlreadySent, input.skippedTooOld, input.maxAgeMs);
  if (input.failed === 0) {
    return `Pushed ${countNoun(input.pushed, 'snapshot')} to ${input.label}.${skipped}`;
  }
  return `Pushed ${String(input.pushed)} of ${String(input.attempted)} snapshots to ${input.label}; ${String(input.failed)} failed.${skipped}`;
}

function nothingNewLine(
  label: string,
  alreadySent: number,
  tooOld: number,
  maxAgeMs: number,
): string {
  const reasons: string[] = [];
  if (alreadySent > 0) {
    reasons.push(`${countNoun(alreadySent, 'snapshot')} already accepted`);
  }
  if (tooOld > 0) {
    reasons.push(`${countNoun(tooOld, 'snapshot')} older than ${formatDuration(maxAgeMs / 1_000)}`);
  }
  if (reasons.length === 0) {
    return `Nothing new to push to ${label}.`;
  }
  return `Nothing new to push to ${label} (${reasons.join(', ')}).`;
}

function skipSuffix(alreadySent: number, tooOld: number, maxAgeMs: number): string {
  const reasons: string[] = [];
  if (alreadySent > 0) {
    reasons.push(`${countNoun(alreadySent, 'snapshot')} already accepted`);
  }
  if (tooOld > 0) {
    reasons.push(`${countNoun(tooOld, 'snapshot')} older than ${formatDuration(maxAgeMs / 1_000)}`);
  }
  return reasons.length === 0 ? '' : ` Skipped ${reasons.join(' and ')}.`;
}

function countNoun(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}
