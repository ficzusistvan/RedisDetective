import { LlmCallError } from './llm-client.js';
import type { LlmClient, LlmCompletionRequest, LlmCompletionResult } from './llm-client.js';

export type LlmFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<{
  readonly status: number;
  text(): Promise<string>;
}>;

export interface CreateOpenAiCompatibleLlmClientOptions {
  readonly apiKey: string;
  readonly model: string;
  /** API root including `/v1`, e.g. `https://api.openai.com/v1`. */
  readonly baseUrl: string;
  /**
   * Required. Passing `fetch` in from the caller — rather than using the `fetch` global —
   * is what keeps a unit test from reaching the network, and what satisfies the reasoner's
   * no-fetch rule.
   */
  readonly fetchImpl: LlmFetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readContent(json: unknown): string | null {
  if (!isRecord(json)) {
    return null;
  }
  const choices = json['choices'];
  if (!Array.isArray(choices) || choices[0] === undefined || !isRecord(choices[0])) {
    return null;
  }
  const message = choices[0]['message'];
  if (!isRecord(message)) {
    return null;
  }
  const content = message['content'];
  return typeof content === 'string' && content !== '' ? content : null;
}

/**
 * An `LlmClient` over the OpenAI-compatible Chat Completions API.
 *
 * Lives here because this is the only package allowed to talk to a model. The HTTP call goes
 * through `fetchImpl`; this file never mentions `fetch` as a global.
 */
export function createOpenAiCompatibleLlmClient(
  options: CreateOpenAiCompatibleLlmClientOptions,
): LlmClient {
  const base = options.baseUrl.replace(/\/$/, '');

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
      let response: Awaited<ReturnType<LlmFetch>>;
      try {
        response = await options.fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            temperature: request.temperature,
            max_tokens: request.maxOutputTokens,
            messages: request.messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        });
      } catch (error) {
        throw new LlmCallError('Could not reach the language-model API.', { cause: error });
      }

      const raw = await response.text();
      if (response.status < 200 || response.status >= 300) {
        throw new LlmCallError(
          `Language-model API request failed with HTTP ${String(response.status)}.`,
        );
      }

      let json: unknown;
      try {
        json = JSON.parse(raw) as unknown;
      } catch (error) {
        throw new LlmCallError('Language-model API returned non-JSON.', { cause: error });
      }

      const text = readContent(json);
      if (text === null) {
        throw new LlmCallError('Language-model API returned a completion with no text.');
      }

      return { text, provider: 'openai-compatible', model: options.model };
    },
  };
}
