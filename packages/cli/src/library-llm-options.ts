import { createOpenAiCompatibleLlmClient } from '@redis-detective/reasoner';
import type { LlmClient, LlmFetch } from '@redis-detective/reasoner';

import { DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL } from './llm-defaults.js';

/**
 * Explicit LLM rewording. Passing this is the only way the library talks to a model — it never
 * reads `LLM_API_KEY` from the environment.
 */
export interface LibraryLlmOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** API root including `/v1`, e.g. `https://api.openai.com/v1`. */
  readonly baseUrl?: string;
}

export function llmClientFromLibraryOptions(
  llm: LibraryLlmOptions,
  fetchImpl: LlmFetch,
): LlmClient {
  return createOpenAiCompatibleLlmClient({
    apiKey: llm.apiKey,
    model: llm.model ?? DEFAULT_LLM_MODEL,
    baseUrl: llm.baseUrl ?? DEFAULT_LLM_BASE_URL,
    fetchImpl,
  });
}
