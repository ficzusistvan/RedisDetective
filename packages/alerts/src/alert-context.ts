/**
 * Facts the notifier may quote. Host is already password-redacted by the CLI.
 * Commit SHAs are hints the diagnosis already had — watch does not look up GitHub.
 */
export interface AlertCommitHint {
  readonly sha: string;
  readonly shortSha: string;
  readonly message: string;
}

export interface AlertLikelyCause {
  readonly pattern: string;
  readonly description: string;
}

export interface AlertContext {
  /** Password-redacted Redis URL, or a placeholder when none is known. */
  readonly host: string;
  readonly likelyCause: AlertLikelyCause | null;
  readonly commitHints: readonly AlertCommitHint[];
}
