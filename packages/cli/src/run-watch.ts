import type { RedisCommandClient } from '@redis-detective/sampler';

import { CLI_NAME } from './cli-usage.js';
import { formatDuration } from './format-bytes.js';
import { formatWatchTick } from './format-watch-tick.js';
import { runDiagnosis } from './run-diagnosis.js';
import type { SnapshotStore } from './snapshot-store.js';

export interface WatchDeps {
  /** Resolves after `ms`, or as soon as `stopSignal` aborts. Injected so tests need no timers. */
  readonly wait: (ms: number, stopSignal: AbortSignal) => Promise<void>;
}

function waitOrAbort(ms: number, stopSignal: AbortSignal): Promise<void> {
  if (stopSignal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      stopSignal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    stopSignal.addEventListener('abort', finish, { once: true });
  });
}

export const DEFAULT_WATCH_DEPS: WatchDeps = { wait: waitOrAbort };

export interface RunWatchRequest {
  readonly store: SnapshotStore;
  readonly client: RedisCommandClient;
  /** Password-redacted, always. See `redactRedisUrl`. */
  readonly target: string;
  readonly intervalMs: number;
  readonly sampleSize: number | null;
  readonly timeoutMs: number | null;
  readonly memorySamples: number | null;
  readonly databases: readonly number[] | null;
  readonly redactKeys: boolean;
  /**
   * `owner/repo` the user asked about, for the notice that says commits are not looked up here.
   * Never used to query GitHub — see the class comment.
   */
  readonly repository: string | null;
  /** Tick timestamps come from here, so a test can pin them. */
  readonly now: () => Date;
  /**
   * Aborted on SIGINT/SIGTERM. Read only between ticks, so the sample in flight always finishes
   * and is saved whole.
   */
  readonly stopSignal: AbortSignal;
  readonly writeLine: (line: string) => void;
}

export interface WatchSummary {
  readonly snapshotsTaken: number;
  /** Everything in the store when watching stopped, including snapshots from earlier sessions. */
  readonly snapshotsInStore: number;
}

function diagnosisCommand(request: RunWatchRequest): string {
  const base = `${CLI_NAME} --snapshots ${request.store.describe}`;
  return request.repository === null ? base : `${base} --repo ${request.repository}`;
}

function openingLines(request: RunWatchRequest): readonly string[] {
  const lines = [
    `Watching ${request.target} every ${formatDuration(request.intervalMs / 1_000)}, saving to ${request.store.describe}.`,
    'One line per sample, not the full report. Ctrl-C stops after the sample in flight.',
  ];
  if (request.repository !== null) {
    lines.push(
      `Candidate commits are not looked up while watching, so a long session makes no GitHub requests. Run ${diagnosisCommand(request)} afterwards for those.`,
    );
  }
  return lines;
}

function closingLines(request: RunWatchRequest, summary: WatchSummary): readonly string[] {
  return [
    `Stopped. ${String(summary.snapshotsTaken)} sample(s) taken this session; ${request.store.describe} now holds ${String(summary.snapshotsInStore)}.`,
    `Full diagnosis: ${diagnosisCommand(request)}`,
  ];
}

/**
 * Samples on an interval until interrupted, printing one line per sample.
 *
 * Each tick is a whole `runDiagnosis` with no repository attached, so watching shares one code
 * path with the single-shot command: the same bounded sample, the same snapshot file, the same
 * deterministic `EvidenceGraph`. Nothing here samples Redis or writes a snapshot itself, which is
 * what stops a long-running loop from drifting away from the command users actually diagnose with.
 *
 * Three things are deliberately *not* done per tick:
 *
 * - **No GitHub.** `repository` is passed as `null`, so commit lookup is unreachable rather than
 *   merely skipped. A watch left running for a day would otherwise spend a rate limit on the same
 *   window over and over, for a report nobody is reading yet.
 * - **No model.** No `llmClient` is forwarded, so the paragraph stays the deterministic template.
 *   A tick only needs to know whether a cause was named; paying a provider per interval for prose
 *   that is then reduced to one line is waste.
 * - **No report.** One line, because a session can run for days.
 *
 * Stopping is cooperative: `stopSignal` is examined between ticks only, never mid-sample, so an
 * interrupt can never leave a partially written snapshot behind.
 */
export async function runWatch(
  request: RunWatchRequest,
  deps: WatchDeps = DEFAULT_WATCH_DEPS,
): Promise<WatchSummary> {
  const { stopSignal, writeLine } = request;

  for (const line of openingLines(request)) {
    writeLine(line);
  }

  let snapshotsTaken = 0;

  while (!stopSignal.aborted) {
    const report = await runDiagnosis({
      store: request.store,
      client: request.client,
      generatedAt: request.now().toISOString(),
      target: request.target,
      sampleSize: request.sampleSize,
      timeoutMs: request.timeoutMs,
      memorySamples: request.memorySamples,
      databases: request.databases,
      redactKeys: request.redactKeys,
      repository: null,
    });
    snapshotsTaken += 1;

    const sampled = report.snapshots[report.snapshots.length - 1];
    if (sampled === undefined) {
      throw new Error(
        `${request.store.describe} returned no snapshots immediately after one was saved to it.`,
      );
    }

    writeLine(
      formatWatchTick({
        at: report.generatedAt,
        sampledKeys: sampled.sampling.observedSampleSize,
        usedMemoryBytes: sampled.memory.usedMemoryBytes,
        snapshotCount: report.snapshots.length,
        causePattern: report.explanation.likelyCause?.pattern ?? null,
      }),
    );

    if (stopSignal.aborted) {
      break;
    }
    await deps.wait(request.intervalMs, stopSignal);
  }

  const summary: WatchSummary = {
    snapshotsTaken,
    snapshotsInStore: (await request.store.list()).length,
  };
  for (const line of closingLines(request, summary)) {
    writeLine(line);
  }
  return summary;
}
