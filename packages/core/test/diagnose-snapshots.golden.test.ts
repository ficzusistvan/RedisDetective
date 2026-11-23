import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  diagnoseSnapshots,
  parseStoredSnapshot,
} from '@redis-detective/core';
import type { DiagnosisJson, RedisSnapshot } from '@redis-detective/core';

const goldenRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'golden');
const GENERATED_AT = '2026-08-25T14:00:00.000Z';
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const CASES = [
  'flat-no-growth',
  'single-snapshot',
  'below-threshold-growth',
  'clear-leak',
  'ttl-drift',
  'snapshot-gap',
] as const;

function loadSnapshots(caseName: string): readonly RedisSnapshot[] {
  const dir = join(goldenRoot, caseName, 'snapshots');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.snapshot.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => {
      const location = join(dir, name);
      return parseStoredSnapshot(JSON.parse(readFileSync(location, 'utf8')) as unknown, location);
    });
}

function loadExpected(caseName: string): DiagnosisJson {
  return JSON.parse(
    readFileSync(join(goldenRoot, caseName, 'expected.diagnosis.json'), 'utf8'),
  ) as DiagnosisJson;
}

function loadExpectedText(caseName: string): string {
  return readFileSync(join(goldenRoot, caseName, 'expected.text.txt'), 'utf8');
}

function loadExpectedMarkdown(caseName: string): string {
  return readFileSync(join(goldenRoot, caseName, 'expected.markdown.md'), 'utf8');
}

function normalize(diagnosis: DiagnosisJson, caseName: string): DiagnosisJson {
  return {
    ...diagnosis,
    storeLocation: `<golden>/${caseName}`,
    target: null,
    savedLocation: null,
  };
}

/**
 * Store paths and clocks in published prose goldens must stay machine-independent.
 * Text/markdown rendering lives in the CLI; this package asserts the files themselves stay clean
 * and that JSON diagnosis still matches. CLI golden tests compare rendered prose to these files.
 */
function assertProseGoldenIsPortable(text: string, caseName: string): void {
  expect(text).not.toMatch(/\/Users\//);
  expect(text).not.toMatch(/\/home\//);
  // Windows drive paths only — do not treat `https://` as a drive letter.
  expect(text).not.toMatch(/[A-Za-z]:\\|(?:^|[^a-zA-Z0-9])[A-Za-z]:\/(?!\/)/);
  expect(text).toContain(`<fixtures>/${caseName}/snapshots`);
}

/**
 * Explanation prose must stay readable: no raw millisecond suffixes and no kebab-case internal
 * kind / mechanism identifiers. Graph `kind` fields are out of scope — only strings a person reads.
 */
function collectExplanationProse(diagnosis: DiagnosisJson): readonly string[] {
  const explanation = diagnosis.explanation;
  const parts: string[] = [
    explanation.headline,
    explanation.summary,
    ...explanation.recommendedActions,
    ...explanation.unknowns,
  ];
  for (const citation of explanation.supportingEvidence) {
    parts.push(citation.statement);
  }
  if (explanation.likelyCause !== null) {
    parts.push(explanation.likelyCause.description);
    for (const citation of explanation.likelyCause.citations) {
      parts.push(citation.statement);
    }
  }
  return parts;
}

/**
 * Tokens that match the snake_case probe but are intentional human-facing wording, not leaked ids.
 * Keep this list narrow; prefer fixing the prose over growing the allowlist.
 */
const HUMAN_PROSE_SNAKE_ALLOWLIST = [
  // GitHub App permission scope cited in the no-repository-connected remedy.
  'pull_requests',
] as const;

const KEBAB_INTERNAL_ID =
  /\b(?:ttl-(?:removed|coverage-declining|lengthened)|never-expiring-growth|memory-(?:growth|step-change)|fragmentation-growth|key-count-growth|eviction-onset|more-keys|larger-values|keys-not-expiring|snapshot-gap|insufficient-snapshots|sample-too-small|unattributed-growth|no-growth-detected|pattern-not-comparable|memory-not-comparable|no-repository-connected|github-unavailable)\b/;

const SNAKE_CASE_ID = /\b[a-z]+_[a-z_]+\b/;
const CAMEL_CASE_ID = /\b[a-z]+[A-Z][a-zA-Z]+\b/;
const CODE_MARKERS = /`|\$\{|\bundefined\b|\bNaN\b|\[object Object\]/;

/**
 * Strip intentional markdown inline code and fixture store paths before scanning for leaked
 * identifiers. Markdown wraps Redis key patterns in backticks on purpose; fixture directories can
 * share names with internal kind ids (e.g. `snapshot-gap`).
 */
function normalizeHumanOutputForProseCheck(text: string): string {
  return text
    .replace(/`[^`]*`/g, ' ')
    .replace(/<fixtures>\/[a-z0-9-]+\/snapshots/g, '<fixtures>/case/snapshots')
    .replace(/<golden>\/[a-z0-9-]+/g, '<golden>/case');
}

function assertHumanProse(text: string, label: string): void {
  const prose = normalizeHumanOutputForProseCheck(text);
  const snakeAllow = new Set<string>(HUMAN_PROSE_SNAKE_ALLOWLIST);
  const snakeHits = [...prose.matchAll(new RegExp(SNAKE_CASE_ID, 'g'))]
    .map((match) => match[0])
    .filter((token) => !snakeAllow.has(token));

  expect(prose, `${label} must not contain raw <digits>ms`).not.toMatch(/\d+ms\b/);
  expect(prose, `${label} must not contain kebab-case internal ids`).not.toMatch(KEBAB_INTERNAL_ID);
  expect(snakeHits, `${label} must not contain snake_case identifiers`).toEqual([]);
  expect(prose, `${label} must not contain camelCase identifiers`).not.toMatch(CAMEL_CASE_ID);
  expect(
    prose,
    `${label} must not contain leftover template or code markers`,
  ).not.toMatch(CODE_MARKERS);
}

function assertExplanationProseIsHuman(diagnosis: DiagnosisJson, caseName: string): void {
  assertHumanProse(collectExplanationProse(diagnosis).join('\n'), `${caseName} explanation`);
}

describe('diagnoseSnapshots golden fixtures', () => {
  for (const caseName of CASES) {
    it(`${caseName} matches expected.diagnosis.json`, async () => {
      const actual = normalize(
        await diagnoseSnapshots({
          snapshots: loadSnapshots(caseName),
          generatedAt: GENERATED_AT,
          storeLocation: `<golden>/${caseName}`,
          target: null,
        }),
        caseName,
      );

      if (UPDATE) {
        writeFileSync(
          join(goldenRoot, caseName, 'expected.diagnosis.json'),
          `${JSON.stringify(actual, null, 2)}\n`,
        );
      }

      expect(actual).toEqual(loadExpected(caseName));
      assertExplanationProseIsHuman(actual, caseName);
    });

    it(`${caseName} text and markdown goldens are portable`, () => {
      assertProseGoldenIsPortable(loadExpectedText(caseName), caseName);
      assertProseGoldenIsPortable(loadExpectedMarkdown(caseName), caseName);
    });

    it(`${caseName} text and markdown goldens stay human-readable`, () => {
      assertHumanProse(loadExpectedText(caseName), `${caseName} text`);
      assertHumanProse(loadExpectedMarkdown(caseName), `${caseName} markdown`);
    });
  }
});
