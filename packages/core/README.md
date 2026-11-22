# `@redis-detective/core`

Side-effect-free Redis memory growth analysis. Same evidence graph and diagnosis JSON that the
`redis-detective` CLI prints under `--json`, with no Redis connection, no GitHub, and no
filesystem.

```bash
npm install @redis-detective/core
```

```ts
import {
  diagnoseSnapshots,
  parseStoredSnapshot,
  serializeSnapshotFile,
} from '@redis-detective/core';

const snapshots = files.map((file, i) => parseStoredSnapshot(JSON.parse(file), `snap-${i}`));

const diagnosis = await diagnoseSnapshots({
  snapshots,
  generatedAt: new Date().toISOString(), // caller supplies the clock
  storeLocation: './snaps',
});
```

## What it does

- Parse and serialize versioned snapshot files (`parseStoredSnapshot`, `serializeSnapshotFile`).
- Build an `EvidenceGraph` (`buildEvidenceGraph`) and explain it (`explainEvidence`, optional
  injected `LlmClient`).
- Produce the CLI-identical `DiagnosisJson` via `diagnoseSnapshots` / `toDiagnosisJson`.

Every derived byte count is an **estimate** unless labelled otherwise. There are no numeric
confidence scores — only `strong` | `moderate` | `unclear`.

## Purity

This package does not import `node:*`, `fetch`, `process.env`, `Date.now()`, `Math.random()`,
`redis`, or the sampler / GitHub / alerts packages. Pass `generatedAt` in. Node `>= 20.11`.

## Snapshot contract

See [`SNAPSHOT_FORMAT.md`](./SNAPSHOT_FORMAT.md) (shipped in the npm package). The version-1 file
envelope is also published as `@redis-detective/core/snapshot-file.schema.json`. Golden fixtures
under `fixtures/golden` are the shared oracle for the CLI and the web runner.

## License

`FSL-1.1-Apache-2.0`.
