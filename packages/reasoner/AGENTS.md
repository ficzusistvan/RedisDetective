# AGENTS.md — packages/reasoner

## The rule

This is the **only** package in the repository permitted to call an LLM. Within it, two limits are
absolute:

1. **It may not fetch data.** No Redis connection, no GitHub API call, no HTTP client, no file
   reads, no imports of `@redis-detective/sampler` or `@redis-detective/github-integration`.
   Everything it reasons about arrives as a function argument: an `EvidenceGraph` and a
   `GitCommitCandidate[]`.
2. **It may not invent facts.** Every claim in an `Explanation` must trace back, via an
   `ExplanationCitation`, to a node already present in the supplied evidence. If the evidence does
   not support naming a cause, the correct output is `likelyCause: null` with populated `unknowns`
   — not a plausible guess.

Also in force here: **no numeric confidence scores**, ever. Use `EvidenceStrength`
(`'strong' | 'moderate' | 'unclear'`). See the root [`AGENTS.md`](../../AGENTS.md).

## Why

All causal reasoning that matters is deterministic and lives in `packages/evidence`, where it can be
unit tested against fixtures and where a wrong answer shows up as a failing test. This package's job
is translation: turning an evidence graph into a paragraph an engineer can act on. That is a
presentation concern, and it is the only part of the pipeline where a language model earns its place.

The moment the model is allowed to gather or infer facts, we lose the two properties the product is
actually selling:

- **Traceability.** "Why did you tell me it was `session:*`?" has to be answerable by pointing at a
  measured byte delta between two snapshots, not at a model's prior about what usually causes Redis
  growth.
- **Reproducibility.** The same snapshots must yield the same conclusions. If the model contributes
  facts, the conclusion becomes non-deterministic, and no regression test can pin it down.

There is also a plain failure-mode argument. An engineer acting on our output may delete keys or
change TTLs in production. A confident, fluent, invented cause is worse than no answer at all,
because fluency is exactly what makes it get acted on.

## Working in here

- **`explainEvidence` takes an `LlmClient` as a parameter.** It never constructs a provider client.
  That is what makes "mock the LLM in tests" possible, and it keeps provider SDKs out of the
  dependency graph of every other package.
- **`validateExplanationAgainstEvidence` is not optional.** Run it on every generated explanation
  and drop or downgrade unsupported claims. Model output is untrusted input; treat it that way.
- **Prompts include only what is in the evidence.** No general Redis lore, no "commonly this is
  caused by…" framing that invites the model to fill gaps from its priors. Keep prompt text in
  `build-explanation-prompt.ts` and bump `promptVersion` when it changes, so an explanation can be
  traced to the prompt that produced it.
- **There must be a deterministic fallback.** If no `LlmClient` is supplied, or the call fails,
  produce a plainer explanation from the evidence with `model: null`. The tool must still work with
  no API key — Phase 1 ships without one.
- **Tests never call a real model.** Inject a fake `LlmClient`. Assert on prompt construction and on
  the validator rejecting claims absent from the evidence; the guard matters more than the prose.
