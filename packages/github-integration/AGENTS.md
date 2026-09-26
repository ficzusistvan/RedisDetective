# AGENTS.md — packages/github-integration

## The rule

**Preferred auth** is a **GitHub App installation**. When App environment is complete, use it —
never a personal access token for that path. The private key is read from the environment at call
time and never committed (`*.pem` is gitignored). Installation tokens live in memory, expire in
about an hour, and must not be logged, persisted, or interpolated into error messages.

When App environment is **incomplete**, the **CLI** (not this package’s business logic) may supply
a bearer token from `gh auth token` / `GITHUB_TOKEN` / `GH_TOKEN` into
`createGitHubRestCommitSource`. `--skip-gh` omits `gh` and uses the token variables only. That
dual-auth policy is ADR 0002. This package still must not call `gh` or invent a second HTTP stack
for PATs — same REST source, different token.

`GitHubCommitSource` is the read surface. `findCandidateCommits` takes one as an argument. Tests
inject a fake; production (`packages/cli`) injects `createGitHubRestCommitSource`. This package
must not call `fetch` except inside `createGitHubHttp`, and `createGitHubHttp` requires the
caller to pass `fetch` in — so a unit test cannot silently reach the network.

Returns **candidates**, not causes. Temporal proximity and a matching key prefix are hints.
Ranking a hint as _the_ cause here would let a guess reach the user wearing the authority of
evidence.

## Why

A long-lived PAT with broad `repo` scope is more access than "list commits in a window" needs, and
it would then sit in a config file. An App installation is per-repository, least-privilege
(`contents: read`, `pull_requests: read`), revocable, and auditable by the org that installed it.
Solo operators still need a path that does not require creating an App mid-incident; that path is
deliberately a CLI concern so this package stays a narrow GitHub HTTP + candidate classifier.

Keeping HTTP behind `GitHubHttp` / `GitHubCommitSource` is what makes `pnpm test` possible with
no network: the interesting logic (window widening, pattern matching, temporal classification,
PR picking) runs against a fake and is therefore deterministic.

## Working in here

- **Do not log JWTs, tokens, or PEM contents.** An error may name an HTTP status and a
  `owner/repo`. It may not echo a credential.
- **Do not retry on 401.** The token expired; the caller re-authenticates.
- **Do not retry on 403/429.** Surface `GitHubRateLimitError` and stop. A retry storm against
  GitHub is how an on-call tool becomes an incident of its own.
- **Do not pass `repositories` when creating an installation token.** The installation already
  scopes which repos the App can see. Naming them again is how GitHub returns HTTP 422
  ("not accessible to the parent installation"). Request `contents: read` and
  `pull_requests: read` only.
- **Drop commits after the anomaly window end.** They are outside the Commit candidate window;
  listing them for “rule-out” promised a product behaviour the search did not deliver.
- Tests live in `test/*.test.ts` and inject fakes. No live API, no token, no rate limit.
