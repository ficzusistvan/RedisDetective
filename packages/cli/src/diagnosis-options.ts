import type { LibraryLlmOptions } from './library-llm-options.js';
import type { LibrarySamplingOptions } from './library-sampling-options.js';

export interface DiagnosisOptions extends LibrarySamplingOptions {
  /** Directory of `*.snapshot.json` files — the same path `--snapshots` takes. */
  readonly directory: string;
  /**
   * When set, this run samples live Redis, saves the snapshot, then diffs. When omitted, the
   * directory is read as-is and no Redis connection is opened.
   */
  readonly url?: string;
  /** ISO-8601 UTC. Defaults to now. Pass a fixed value to make tests reproducible. */
  readonly generatedAt?: string;
  /**
   * `owner/repo` to search for candidate commits. Omit to skip GitHub entirely. The library
   * never reads `GITHUB_TOKEN` or App env vars — pass `githubToken` alongside this.
   */
  readonly repository?: string;
  /** Personal access token used only when `repository` is set. Never read from the environment. */
  readonly githubToken?: string;
  /** Hours before the growth window to search. Defaults to seven days. */
  readonly lookbackHours?: number;
  /**
   * Explicit LLM rewording. Omit for the deterministic paragraph. The library never reads
   * `LLM_API_KEY`.
   */
  readonly llm?: LibraryLlmOptions;
}
