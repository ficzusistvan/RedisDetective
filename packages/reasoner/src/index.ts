/* ==========================================================================================
 * @redis-detective/reasoner
 *
 * ARCHITECTURAL CONSTRAINT — this is a hard rule, not a guideline. Do not work around it.
 *
 *   1. This is the ONLY package in Redis Detective permitted to call an LLM.
 *      No other package may import an LLM SDK. ESLint enforces this; the rule exists because
 *      every causal conclusion the product makes must come from deterministic, unit-tested code
 *      in packages/evidence, not from a model.
 *
 *   2. This package MUST NOT fetch its own data.
 *      It receives an EvidenceGraph and a GitCommitCandidate[] as arguments (see ReasonerInput)
 *      and reasons over those alone. It may not open a Redis connection, call the GitHub API,
 *      make an HTTP request, read the filesystem, or read the clock. It may not import
 *      @redis-detective/sampler or @redis-detective/github-integration.
 *
 *   3. This package MUST NOT invent facts.
 *      Every claim in an Explanation must trace back — via an ExplanationCitation — to a node
 *      already present in the supplied EvidenceGraph or to a supplied commit candidate. If the
 *      evidence does not support naming a cause, the correct output is `likelyCause: null` with
 *      populated `unknowns`. A fluent, confident, invented cause is the single most damaging
 *      output this product can produce, because fluency is what makes an engineer act on it in
 *      production. `validateExplanationAgainstEvidence` exists to enforce this after generation;
 *      run it on every explanation and drop or downgrade whatever fails.
 *
 *   4. No numeric confidence scores. Use EvidenceStrength: 'strong' | 'moderate' | 'unclear'.
 *
 * The LLM's entire job here is translation: turning already-established evidence into a paragraph
 * an engineer can act on. Anything beyond that belongs in packages/evidence.
 *
 * See packages/reasoner/AGENTS.md and the root AGENTS.md for the full reasoning.
 * ========================================================================================== */

export { LlmCallError } from './llm-client.js';
export type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
} from './llm-client.js';

export { collectCitableEvidenceIds, gapEvidenceId } from './reasoner-input.js';
export type { ReasonerInput } from './reasoner-input.js';

export { PROMPT_VERSION, buildExplanationPrompt } from './build-explanation-prompt.js';

export {
  EXPLANATION_VIOLATION_KINDS,
  isEvidenceKind,
  validateExplanationAgainstEvidence,
} from './validate-explanation-against-evidence.js';
export type {
  ExplanationValidationResult,
  ExplanationViolation,
  ExplanationViolationKind,
} from './validate-explanation-against-evidence.js';

export { summarizeEvidenceDeterministically } from './summarize-evidence-deterministically.js';

export { parseLlmExplanation } from './parse-llm-explanation.js';
export type { ParseLlmExplanationContext } from './parse-llm-explanation.js';

export { createOpenAiCompatibleLlmClient } from './create-openai-compatible-llm-client.js';
export type {
  CreateOpenAiCompatibleLlmClientOptions,
  LlmFetch,
} from './create-openai-compatible-llm-client.js';

export { explainEvidence } from './explain-evidence.js';
export type { ExplainEvidenceDeps } from './explain-evidence.js';
