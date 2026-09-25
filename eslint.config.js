import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Several rules below are not style preferences — they are the machine-checkable half of the hard
 * architectural rules in AGENTS.md. Read AGENTS.md before relaxing any `no-restricted-*` block.
 */

const LLM_MODULES = [
  'openai',
  '@openai/*',
  '@anthropic-ai/*',
  '@google/generative-ai',
  '@google/genai',
  'ai',
  '@ai-sdk/*',
  'langchain',
  '@langchain/*',
  'ollama',
  'cohere-ai',
  '@mistralai/*',
];

/**
 * Flat config replaces a rule's options wholesale when a later block sets the same rule, so every
 * block that configures `no-restricted-imports` for a non-reasoner package must restate this
 * group. Omitting it would silently drop the LLM restriction for that package.
 */
const LLM_RESTRICTION = {
  group: LLM_MODULES,
  message:
    'Only packages/reasoner may call an LLM. See AGENTS.md, "Only the reasoner talks to an LLM".',
};

const networkRestrictions = (message) => [
  { name: 'node:http', message },
  { name: 'node:https', message },
  { name: 'node:net', message },
  { name: 'node:dgram', message },
  { name: 'undici', message },
  { name: 'axios', message },
  { name: 'node-fetch', message },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/publish/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      // Agent skill templates (scaffolding samples), not product source.
      '.agents/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },

  // HARD RULE: only packages/reasoner may talk to an LLM.
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    ignores: ['packages/reasoner/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LLM_RESTRICTION] }],
    },
  },

  // HARD RULE: evidence/ is pure, deterministic and offline.
  {
    files: ['packages/evidence/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [LLM_RESTRICTION],
          paths: [
            ...networkRestrictions('evidence/ must be pure and offline.'),
            {
              name: '@redis-detective/sampler',
              message:
                'evidence/ consumes RedisSnapshot values; it must not depend on how they were collected.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'evidence/ must be pure and offline.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'evidence/ must be deterministic. Take a seeded source as an argument if randomness is ever needed.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'evidence/ must be deterministic: pass timestamps in as arguments.',
        },
      ],
    },
  },

  // HARD RULE: the reasoner explains evidence it was handed; it never gathers its own.
  {
    files: ['packages/reasoner/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...networkRestrictions(
              'The reasoner must not fetch data. It receives an EvidenceGraph and GitCommitCandidates as arguments.',
            ),
            {
              name: '@redis-detective/sampler',
              message:
                'The reasoner must not sample Redis itself. Accept a RedisSnapshot-derived EvidenceGraph as input.',
            },
            {
              name: '@redis-detective/github-integration',
              message:
                'The reasoner must not fetch commits itself. Accept GitCommitCandidate[] as input.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'The reasoner must not fetch data. Inject an LlmClient instead.',
        },
      ],
    },
  },

  // HARD RULE: the sampler is read-only and never enumerates the key space.
  {
    files: ['packages/sampler/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [LLM_RESTRICTION] }],
      'no-restricted-syntax': [
        'error',
        {
          // Commands with no JS-builtin namesake, so matching the call site is unambiguous.
          selector:
            'CallExpression > MemberExpression[property.name=/^(flushdb|flushall|eval|evalsha|shutdown|migrate|randomkey)$/]',
          message:
            'Forbidden Redis command. The sampler is read-only and must never mutate or enumerate the key space. See packages/sampler/AGENTS.md.',
        },
        {
          // `.keys()` is scoped to client-shaped receivers so Map#keys and Object.keys stay usable.
          selector:
            'CallExpression > MemberExpression[object.name=/^(client|redis|redisClient|conn|connection|unsafe)$/][property.name="keys"]',
          message:
            'KEYS is O(N) and blocks the Redis single thread. Use bounded scanKeySample instead. See packages/sampler/AGENTS.md.',
        },
        {
          // The likeliest real violation: widening RedisCommandClient to expose a forbidden
          // command. Method signatures only, so data properties such as
          // `ScanResponse.keys: readonly string[]` stay legal.
          selector:
            'TSMethodSignature[key.name=/^(keys|flushdb|flushall|eval|evalsha|command|sendCommand|randomkey|debug)$/]',
          message:
            'Do not widen the Redis client contract with an unbounded or generic command; that would let a caller route around the sampling bounds. See packages/sampler/AGENTS.md.',
        },
      ],
    },
  },

  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Developer scripts run under Node directly, outside any package.
  {
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
