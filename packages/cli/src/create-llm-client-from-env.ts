import type { LlmClient } from '@redis-detective/reasoner';
import { createOpenAiCompatibleLlmClient } from '@redis-detective/reasoner';

const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Builds an LLM client from the environment, or `null` when no key is set.
 *
 * The reasoner is the only package that talks to a model; this function only chooses whether
 * to construct the injected client. Missing `LLM_API_KEY` is the normal Phase 1 path.
 */
export function createLlmClientFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: (url: string, init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  }) => Promise<{ readonly status: number; text(): Promise<string> }>,
): LlmClient | null {
  const apiKey = env['LLM_API_KEY']?.trim();
  if (apiKey === undefined || apiKey === '') {
    return null;
  }

  const model = env['LLM_MODEL']?.trim() || DEFAULT_MODEL;
  const baseUrl = env['LLM_BASE_URL']?.trim() || DEFAULT_BASE_URL;

  return createOpenAiCompatibleLlmClient({
    apiKey,
    model,
    baseUrl,
    fetchImpl,
  });
}
