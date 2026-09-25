# AGENTS.md — packages/github-integration

## The rule

Authentication is a **GitHub App installation**, never a personal access token and never a raw
OAuth token pasted into config. The private key is read from the environment at call time and
never committed (`*.pem` is gitignored). Installation tokens live in memory, expire in about an
hour, and must not be logged, persisted, or interpolated into error messages.

`GitHubCommitSource` is the read surface. `findCandidateCommits` takes one as an argument. Tests
inject a fake; production (`packages/cli`) injects `createGitHubRestCommitSource`. This package
must not call `fetch` except inside `createGitHubHttp`, and `createGitHubHttp` requires the
caller to pass `fetch` in — so a unit test cannot silently reach the network.

Returns **candidates**, not causes. Temporal proximity and a matching key prefix are hints.
Ranking a hint as *the* cause here would let a guess reach the user wearing the authority of
evidence.

## Why

A PAT with `repo` scope is far more access than "list commits in a window" needs, and it would
then sit in a config file. An App installation is per-repository, least-privilege
(`contents: read`, `pull_requests: read`), revocable, and auditable by the org that installed it.

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
- **Keep `'after-anomaly'` commits.** Dropping them would hide the evidence that a change is too
  late to fall in the growth window (rule-out by timing, not causation).
- Tests live in `test/*.test.ts` and inject fakes. No live API, no token, no rate limit.
