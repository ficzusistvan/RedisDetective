import type {
  LlmClient,
  LlmCompletionRequest,
  LlmCompletionResult,
} from '@redis-detective/reasoner';

/**
 * Records requests and replays a canned response. Reasoner tests must never reach a real model —
 * see packages/reasoner/AGENTS.md.
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmCompletionRequest[] = [];

  private readonly response: string;

  private readonly failure: Error | null;

  constructor(response = 'stub explanation', failure: Error | null = null) {
    this.response = response;
    this.failure = failure;
  }

  get callCount(): number {
    return this.requests.length;
  }

  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    this.requests.push(request);
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    return Promise.resolve({
      text: this.response,
      provider: 'fake',
      model: 'fake-model-1',
    });
  }
}
