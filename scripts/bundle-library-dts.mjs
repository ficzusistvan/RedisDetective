#!/usr/bin/env node

/**
 * Inlines `packages/cli/dist/api.d.ts` and the declarations it reaches into one file, so the
 * published package's `index.d.ts` does not mention `@redis-detective/*` workspace packages.
 *
 * Barrel `index.d.ts` files are followed by exported name, not dumped wholesale. Non-entry
 * exports are demoted so test-only seams cannot be imported from `redis-detective`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function fromSpecPattern() {
  return /(?:import|export)(?:\s+type)?\s+(?:type\s+)?(\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"];?/g;
}

function sideEffectImportPattern() {
  return /^import\s+['"]([^'"]+)['"];?\s*$/gm;
}

export function bundleLibraryDts(entryPath) {
  const visited = new Set();
  const pieces = [];

  function walk(filePath, needed) {
    const resolved = resolveExisting(filePath);
    let text = readFileSync(resolved, 'utf8');
    text = text.replace(/\/\/# sourceMappingURL=.*$/gm, '');

    if (isBarrel(text)) {
      const visitKey = `${resolved}#${needed === undefined ? '*' : [...needed].sort().join(',')}`;
      if (visited.has(visitKey)) {
        return;
      }
      visited.add(visitKey);
      for (const { spec, names } of collectNamedImports(text)) {
        const nextNeeded = intersectNeeded(needed, names);
        if (nextNeeded !== undefined && nextNeeded.size === 0) {
          continue;
        }
        walk(resolveSpecifier(resolved, spec), nextNeeded);
      }
      return;
    }

    if (visited.has(resolved)) {
      return;
    }
    visited.add(resolved);

    for (const { spec, names } of collectNamedImports(text)) {
      walk(resolveSpecifier(resolved, spec), names === null ? undefined : new Set(names));
    }

    const stripped = stripImportAndReexportLines(text).trim();
    if (stripped !== '') {
      pieces.push({ filePath: resolved, text: stripped });
    }
  }

  walk(entryPath, undefined);

  const entryResolved = resolveExisting(entryPath);
  const bundled = pieces
    .map(({ filePath, text }) => (filePath === entryResolved ? text : demoteExports(text)))
    .join('\n\n');

  const forbidden = [
    'LibraryEngineDeps',
    'RedisCommandClient',
    'createRedisClient',
    'runLibraryHealthCheck',
    'runLibraryDiagnosis',
    'saveLibrarySnapshot',
    'loadDotenv',
    'createLlmClientFromEnv',
  ];
  for (const name of forbidden) {
    const exported = new RegExp(
      `^export\\s+(?:declare\\s+)?(?:function|class|interface|type|const)\\s+${name}\\b`,
      'm',
    );
    const exportedList = new RegExp(`export\\s+(?:type\\s+)?\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm');
    if (exported.test(bundled) || exportedList.test(bundled)) {
      throw new Error(`Bundled library types must not export ${name}.`);
    }
  }

  if (bundled.includes('@redis-detective/')) {
    throw new Error('Bundled library types still reference @redis-detective/* workspace packages.');
  }

  return `${bundled.trim()}\n`;
}

function isBarrel(text) {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .trim();
  if (code === '') {
    return false;
  }
  return code
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .every((part) => /\bfrom\s+['"]/.test(part));
}

function collectNamedImports(text) {
  const results = [];
  for (const match of text.matchAll(fromSpecPattern())) {
    const bindings = match[1];
    const spec = match[2];
    if (spec === undefined) {
      continue;
    }
    const names =
      bindings !== undefined && bindings.startsWith('{') ? parseBindingNames(bindings) : null;
    results.push({ spec, names });
  }
  for (const match of text.matchAll(sideEffectImportPattern())) {
    const spec = match[1];
    if (spec !== undefined) {
      results.push({ spec, names: null });
    }
  }
  return results;
}

function parseBindingNames(braces) {
  return braces
    .slice(1, -1)
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .filter((part) => part !== '')
    .map((part) => {
      const source = part.split(/\s+as\s+/)[0];
      return source === undefined ? '' : source.trim();
    })
    .filter((name) => name !== '');
}

function intersectNeeded(needed, names) {
  if (needed === undefined) {
    return names === null ? undefined : new Set(names);
  }
  if (names === null) {
    return needed;
  }
  return new Set(names.filter((name) => needed.has(name)));
}

function stripImportAndReexportLines(text) {
  return text
    .replace(fromSpecPattern(), '')
    .replace(sideEffectImportPattern(), '')
    .replace(/\n{3,}/g, '\n\n');
}

function demoteExports(text) {
  return text
    .replace(/^export declare /gm, 'declare ')
    .replace(/^export interface /gm, 'interface ')
    .replace(/^export type /gm, 'type ')
    .replace(/^export class /gm, 'class ')
    .replace(/^export const /gm, 'const ')
    .replace(/^export enum /gm, 'enum ')
    .replace(/^export type \{[^}]*\};?/gm, '')
    .replace(/^export \{[^}]*\};?/gm, '');
}

function resolveSpecifier(fromFile, spec) {
  if (spec.startsWith('.')) {
    const url = new URL(spec, pathToFileURL(fromFile));
    return fileURLToPath(url);
  }
  if (spec.startsWith('@redis-detective/')) {
    const rest = spec.slice('@redis-detective/'.length);
    const [packageName, ...subpath] = rest.split('/');
    if (packageName === undefined || packageName === '') {
      throw new Error(`Could not parse workspace specifier ${spec}.`);
    }
    const distFile =
      subpath.length === 0
        ? join(repoRoot, 'packages', packageName, 'dist', 'index.d.ts')
        : join(repoRoot, 'packages', packageName, 'dist', ...subpath).replace(/\.js$/, '.d.ts');
    return distFile;
  }
  throw new Error(`Refusing to inline non-workspace specifier "${spec}" from ${fromFile}.`);
}

function resolveExisting(filePath) {
  const candidates = dtsCandidates(filePath);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Could not resolve declaration file for ${filePath}. Tried: ${candidates.join(', ')}`,
  );
}

function dtsCandidates(filePath) {
  if (filePath.endsWith('.d.ts')) {
    return [filePath];
  }
  if (filePath.endsWith('.js')) {
    return [filePath.slice(0, -3) + '.d.ts'];
  }
  return [`${filePath}.d.ts`, join(filePath, 'index.d.ts')];
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const entry = process.argv[2] ?? join(repoRoot, 'packages', 'cli', 'dist', 'api.d.ts');
  process.stdout.write(bundleLibraryDts(entry));
}
