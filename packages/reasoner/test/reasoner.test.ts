import { describe, expect, it } from 'vitest';

import {
  LlmCallError,
  PROMPT_VERSION,
  buildExplanationPrompt,
  collectCitableEvidenceIds,
  createOpenAiCompatibleLlmClient,
  explainEvidence,
  parseLlmExplanation,
  summarizeEvidenceDeterministically,
  validateExplanationAgainstEvidence,
} from '@redis-detective/reasoner';

import {
  evidenceGraphFixture,
  leakingCommit,
  leakingReasonerInput,
  reasonerInputFixture,
  validLlmJson,
} from './helpers/evidence-fixture.js';
import { FakeLlmClient } from './helpers/fake-llm-client.js';

describe('collectCitableEvidenceIds', () => {
  it('is empty for an empty graph, so nothing can be cited', () => {
    expect(collectCitableEvidenceIds(reasonerInputFixture()).size).toBe(0);
  });

  it('collects ids from anomalies, attributions, drift events, commits and gaps', () => {
    const input = leakingReasonerInput({
      graph: evidenceGraphFixture({
        ...leakingReasonerInput().graph,
        gaps: [
          {
            kind: 'sample-too-small',
            detail: 'thin sample',
            remedy: 'raise --sample-size',
          },
        ],
      }),
    });

    const ids = collectCitableEvidenceIds(input);
    expect(ids.has('anomaly-memory-growth')).toBe(true);
    expect(ids.has('attribution-cart-items')).toBe(true);
    expect(ids.has('ttl-drift-cart-items')).toBe(true);
    expect(ids.has('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(ids.has('gap:sample-too-small')).toBe(true);
  });
});

describe('summarizeEvidenceDeterministically', () => {
  it('names the leaking pattern, TTL collapse, and hinted commit without calling a model', () => {
    const explanation = summarizeEvidenceDeterministically(leakingReasonerInput());

    expect(explanation.model).toBeNull();
    expect(explanation.likelyCause?.pattern).toBe('cart:items:*');
    expect(explanation.headline).toContain('cart:items:*');
    expect(explanation.headline).toContain('expir');
    expect(explanation.likelyCause?.relatedCommitShas).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]);
    expect(explanation.evidenceStrength).toBe('strong');
    expect(explanation.recommendedActions.length).toBeGreaterThan(0);
    expect(
      validateExplanationAgainstEvidence(explanation, leakingReasonerInput()).valid,
    ).toBe(true);
  });

  it('does not attach after-anomaly SHAs as related commit candidates', () => {
    const explanation = summarizeEvidenceDeterministically(
      leakingReasonerInput({
        commitCandidates: [
          leakingCommit({
            sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            shortSha: 'bbbbbbb',
            temporalRelation: 'after-anomaly',
            matchedPatternHints: ['cart:items:'],
          }),
        ],
      }),
    );

    expect(explanation.likelyCause?.relatedCommitShas).toEqual([]);
  });

  it('says so when there are not enough snapshots, instead of inventing a cause', () => {
    const input = reasonerInputFixture({
      graph: evidenceGraphFixture({
        snapshotIds: ['snapshot-1'],
        gaps: [
          {
            kind: 'insufficient-snapshots',
            detail: 'Growth needs at least two snapshots.',
            remedy: 'Run again later.',
          },
        ],
      }),
    });

    const explanation = summarizeEvidenceDeterministically(input);

    expect(explanation.likelyCause).toBeNull();
    expect(explanation.evidenceStrength).toBe('unclear');
    expect(explanation.headline).toContain('Not enough snapshots');
    expect(explanation.unknowns[0]).toContain('two snapshots');
  });
});

describe('buildExplanationPrompt', () => {
  it('includes evidence ids and commit relations, and does not invite prior-based guesses', () => {
    const prompt = buildExplanationPrompt(leakingReasonerInput());

    expect(prompt.temperature).toBe(0);
    expect(prompt.promptVersion).toBe(PROMPT_VERSION);
    const user = prompt.messages.find((message) => message.role === 'user')?.content ?? '';
    const system = prompt.messages.find((message) => message.role === 'system')?.content ?? '';

    expect(user).toContain('attribution-cart-items');
    expect(user).toContain('cart:items:*');
    expect(user).toContain('before-anomaly');
    expect(system.toLowerCase()).toContain('do not add');
    expect(user.toLowerCase()).not.toContain('common causes');
    expect(system.toLowerCase()).not.toContain('usually caused');
  });
});

describe('validateExplanationAgainstEvidence', () => {
  it('accepts the deterministic explanation of a leaking graph', () => {
    const input = leakingReasonerInput();
    expect(
      validateExplanationAgainstEvidence(summarizeEvidenceDeterministically(input), input).valid,
    ).toBe(true);
  });

  it('rejects a citation of an evidence id that is not in the graph', () => {
    const input = leakingReasonerInput();
    const explanation = summarizeEvidenceDeterministically(input);
    const result = validateExplanationAgainstEvidence(
      {
        ...explanation,
        supportingEvidence: [
          ...explanation.supportingEvidence,
          { evidenceId: 'invented', kind: 'anomaly', statement: 'made up' },
        ],
      },
      input,
    );

    expect(result.valid).toBe(false);
    expect(result.violations.map((violation) => violation.kind)).toContain('unknown-evidence-id');
  });

  it('rejects a pattern that appears in no attribution or drift event', () => {
    const input = leakingReasonerInput();
    const explanation = summarizeEvidenceDeterministically(input);
    const cause = explanation.likelyCause;
    if (cause === null) {
      throw new Error('expected a cause');
    }
    const result = validateExplanationAgainstEvidence(
      { ...explanation, likelyCause: { ...cause, pattern: 'session:*' } },
      input,
    );

    expect(result.violations.map((violation) => violation.kind)).toContain('unsupported-pattern');
  });

  it('rejects a commit that is not a supplied pre-growth candidate', () => {
    const input = leakingReasonerInput();
    const explanation = summarizeEvidenceDeterministically(input);
    const cause = explanation.likelyCause;
    if (cause === null) {
      throw new Error('expected a cause');
    }
    const result = validateExplanationAgainstEvidence(
      {
        ...explanation,
        likelyCause: { ...cause, relatedCommitShas: ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'] },
      },
      input,
    );

    expect(result.violations.map((violation) => violation.kind)).toContain('unsupported-commit');
  });

  it('rejects numeric confidence phrasing', () => {
    const input = leakingReasonerInput();
    const explanation = summarizeEvidenceDeterministically(input);
    const result = validateExplanationAgainstEvidence(
      { ...explanation, summary: `${explanation.summary} We are 87% sure this is the cause.` },
      input,
    );

    expect(result.violations.map((violation) => violation.kind)).toContain(
      'numeric-confidence-claim',
    );
  });

  it('rejects a strength stronger than the evidence', () => {
    const leaking = leakingReasonerInput();
    const attribution = leaking.graph.attributions[0];
    const drift = leaking.graph.ttlDrift[0];
    const anomaly = leaking.graph.anomalies[0];
    if (attribution === undefined || drift === undefined || anomaly === undefined) {
      throw new Error('leaking fixture is missing evidence nodes');
    }

    const input = leakingReasonerInput({
      graph: {
        ...leaking.graph,
        attributions: [{ ...attribution, evidenceStrength: 'moderate' }],
        ttlDrift: [{ ...drift, evidenceStrength: 'moderate' }],
        anomalies: [{ ...anomaly, evidenceStrength: 'moderate' }],
      },
    });
    const explanation = summarizeEvidenceDeterministically(input);
    const result = validateExplanationAgainstEvidence(
      { ...explanation, evidenceStrength: 'strong' },
      input,
    );

    expect(result.violations.map((violation) => violation.kind)).toContain('strength-overstated');
  });
});

describe('parseLlmExplanation', () => {
  it('reads JSON, including fenced JSON, and fills graph metadata', () => {
    const parsed = parseLlmExplanation(`\`\`\`json\n${validLlmJson()}\n\`\`\``, {
      graphId: 'graph-leak',
      generatedAt: '2026-08-25T11:06:00.000Z',
      model: { provider: 'fake', model: 'fake-model-1', promptVersion: PROMPT_VERSION },
    });

    expect(parsed?.likelyCause?.pattern).toBe('cart:items:*');
    expect(parsed?.graphId).toBe('graph-leak');
    expect(parsed?.model?.model).toBe('fake-model-1');
  });

  it('returns null rather than repairing malformed output', () => {
    expect(
      parseLlmExplanation('not json', {
        graphId: 'graph-leak',
        generatedAt: '2026-08-25T11:06:00.000Z',
        model: { provider: 'fake', model: 'fake-1', promptVersion: PROMPT_VERSION },
      }),
    ).toBeNull();
  });
});

describe('explainEvidence', () => {
  it('returns the deterministic baseline when no LLM is supplied', async () => {
    const explanation = await explainEvidence(leakingReasonerInput());

    expect(explanation.model).toBeNull();
    expect(explanation.likelyCause?.pattern).toBe('cart:items:*');
  });

  it('uses a valid LLM explanation and records the model', async () => {
    const llmClient = new FakeLlmClient(validLlmJson());
    const explanation = await explainEvidence(leakingReasonerInput(), { llmClient });

    expect(llmClient.callCount).toBe(1);
    expect(llmClient.requests[0]?.temperature).toBe(0);
    expect(explanation.model?.provider).toBe('fake');
    expect(explanation.likelyCause?.pattern).toBe('cart:items:*');
  });

  it('falls back to the baseline when the model names a pattern the evidence does not support', async () => {
    const llmClient = new FakeLlmClient(
      validLlmJson({
        likelyCause: {
          pattern: 'session:*',
          description: 'I decided it was sessions.',
          relatedCommitShas: [],
          citations: [
            {
              evidenceId: 'attribution-cart-items',
              kind: 'attribution',
              statement: 'wrong pattern',
            },
          ],
        },
      }),
    );

    const explanation = await explainEvidence(leakingReasonerInput(), { llmClient });

    expect(llmClient.callCount).toBe(1);
    expect(explanation.model).toBeNull();
    expect(explanation.likelyCause?.pattern).toBe('cart:items:*');
  });

  it('falls back to the baseline when the LLM call fails', async () => {
    const llmClient = new FakeLlmClient('unused', new LlmCallError('provider down'));
    const explanation = await explainEvidence(leakingReasonerInput(), { llmClient });

    expect(explanation.model).toBeNull();
    expect(explanation.likelyCause?.pattern).toBe('cart:items:*');
  });
});

describe('createOpenAiCompatibleLlmClient', () => {
  it('posts chat completions and does not put the API key in errors', async () => {
    const client = createOpenAiCompatibleLlmClient({
      apiKey: 'sk-secret',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: async (url, init) => {
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(init.headers['Authorization']).toBe('Bearer sk-secret');
        return {
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                choices: [{ message: { content: validLlmJson() } }],
              }),
            ),
        };
      },
    });

    const result = await client.complete(buildExplanationPrompt(leakingReasonerInput()));
    expect(result.text).toContain('cart:items:*');
    expect(result.provider).toBe('openai-compatible');
  });

  it('throws LlmCallError without echoing the key when the API rejects the request', async () => {
    const client = createOpenAiCompatibleLlmClient({
      apiKey: 'sk-secret',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      fetchImpl: async () => ({
        status: 401,
        text: () => Promise.resolve('{"error":"unauthorized"}'),
      }),
    });

    try {
      await client.complete(buildExplanationPrompt(leakingReasonerInput()));
      throw new Error('expected complete to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmCallError);
      expect((error as Error).message).toContain('HTTP 401');
      expect((error as Error).message).not.toContain('sk-secret');
    }
  });
});
