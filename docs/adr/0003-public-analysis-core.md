# Public analysis core

Analysis that both the CLI and the private web runner need lives in a published
`@redis-detective/core` package. The CLI samples Redis, talks to GitHub, watches, alerts, and
renders; core only parses snapshots, builds the evidence graph, explains it, and emits
`DiagnosisJson`. Private packages (`core-types`, `evidence`, `reasoner`) stay in place so existing
ESLint purity rules keep applying; the published core build bundles them the same way the CLI
build does. We rejected leaving analysis only inside the CLI (web would re-implement or vendor
private packages) and rejected making `evidence`/`reasoner` themselves public (that would freeze
internal seams and weaken the “only the reasoner talks to an LLM” boundary). Commits remain
candidates, never Causes — core’s `diagnoseSnapshots` matches `--skip-gh` with no repository,
including the `no-repository-connected` gap when a Redis Cause is strong or moderate enough to
make candidates useful.
