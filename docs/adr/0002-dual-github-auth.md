# Dual GitHub auth: App preferred, personal fallback

## Context

Commit candidates need authenticated read access to a Connected repository. The original rule was
GitHub App installation only — least privilege, revocable, auditable. That is still the right
default for organisations, but it is a steep first-time cliff for solo / `npx` operators who
already have `gh` or a fine-grained token.

## Decision

- When GitHub App environment is **complete** (`GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and
  exactly one private-key source), authenticate with the App and do **not** fall through to a
  personal token.
- When App environment is **incomplete**, discover a personal credential in order:
  `gh auth token` → `GITHUB_TOKEN` → `GH_TOKEN`. Do not invent a product-specific token env var.
  Do not inspect token scopes; document the minimum (contents + pull requests read).
- `--skip-gh` (or `REDIS_DETECTIVE_SKIP_GH=1`) skips `gh auth token` and reads only
  `GITHUB_TOKEN` / `GH_TOKEN`. The local default is unchanged. A hosted runner sets the switch
  so a `gh` login on the server cannot authenticate a customer's repository. A complete App
  environment still wins and never reaches this path.
- CLI resolves credentials and builds a `GitHubCommitSource`; `gh` is injected so unit tests never
  shell out. Auth and commit listing run only when a Connected repository is set **and** there are
  at least two snapshots. Exit code 6 (GitHub unavailable) applies only when candidates were
  expected and GitHub failed.

## Consequences

Solo Pass 2 can use `gh auth login` or a token without creating an App. Org installs stay
predictable: a complete App env always wins over a laptop PAT. Rejected alternatives: keep
App-only and only improve docs; make PAT the default; silently prefer a personal token over a
configured App.
