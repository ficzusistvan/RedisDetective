export interface LlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly messages: readonly LlmMessage[];
  readonly maxOutputTokens: number;
  /** Kept at 0 by default: the same evidence should produce the same wording. */
  readonly temperature: number;
  /** Identifies the prompt that produced an explanation, for `LlmAttribution`. */
  readonly promptVersion: string;
}

export interface LlmCompletionResult {
  readonly text: string;
  readonly provider: string;
  readonly model: string;
}

export class LlmCallError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'LlmCallError';
  }
}

/**
 * The entire LLM surface this package uses, injected by the caller.
 *
 * Narrow and provider-agnostic on purpose. Keeping it an interface means no provider SDK enters the
 * dependency graph, tests inject a fake instead of mocking a module, and there is exactly one seam
 * where model output crosses into the system — which is the seam
 * `validateExplanationAgainstEvidence` guards.
 *
 * Note there is no tool-calling or function-calling surface here, and there must not be: a model
 * able to call tools could fetch its own data, which is precisely what this package's AGENTS.md
 * forbids.
 */
export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
