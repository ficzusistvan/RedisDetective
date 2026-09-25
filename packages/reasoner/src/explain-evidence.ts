import type { Explanation } from '@redis-detective/core-types';

import { PROMPT_VERSION, buildExplanationPrompt } from './build-explanation-prompt.js';
import { LlmCallError } from './llm-client.js';
import type { LlmClient } from './llm-client.js';
import { parseLlmExplanation } from './parse-llm-explanation.js';
import type { ReasonerInput } from './reasoner-input.js';
import { summarizeEvidenceDeterministically } from './summarize-evidence-deterministically.js';
import { validateExplanationAgainstEvidence } from './validate-explanation-against-evidence.js';

export interface ExplainEvidenceDeps {
  /**
   * Omit to get the deterministic, template-only explanation. There is no default client and no
   * provider construction anywhere in this function — the caller owns that choice.
   */
  readonly llmClient?: LlmClient;
}

/**
 * Turns evidence into prose.
 *
 * Reads `input` and nothing else. It does not open a Redis connection, call the GitHub API, read
 * the filesystem or consult the clock; `generatedAt` arrives on `input`. See this package's
 * AGENTS.md.
 *
 * The LLM may only improve the wording. If it changes which Redis pattern is named as the Cause, or
 * attaches commit SHAs that the evidence does not support as related candidates, validation fails
 * and this function returns the deterministic baseline instead.
 */
export async function explainEvidence(
  input: ReasonerInput,
  deps: ExplainEvidenceDeps = {},
): Promise<Explanation> {
  const baseline = summarizeEvidenceDeterministically(input);
  const llmClient = deps.llmClient;
  if (llmClient === undefined) {
    return baseline;
  }

  try {
    const prompt = buildExplanationPrompt(input);
    const completion = await llmClient.complete(prompt);
    const parsed = parseLlmExplanation(completion.text, {
      graphId: input.graph.graphId,
      generatedAt: input.generatedAt,
      model: {
        provider: completion.provider,
        model: completion.model,
        promptVersion: PROMPT_VERSION,
      },
    });
    if (parsed === null) {
      return baseline;
    }
    const validation = validateExplanationAgainstEvidence(parsed, input);
    return validation.valid ? parsed : baseline;
  } catch (error) {
    if (error instanceof LlmCallError) {
      return baseline;
    }
    throw error;
  }
}
