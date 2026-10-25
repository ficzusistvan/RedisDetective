import { AlertConfigError } from './parse-duration-ms.js';

/**
 * Restricted YAML: mappings, sequences, scalars, `#` comments, 2-space indent.
 *
 * Enough for `.redis-detective.yaml`. Not a general YAML implementation — no anchors,
 * tags, multiline blocks, or flow collections beyond a single-line `[a, b]`.
 */
export function parseSimpleYaml(raw: string): unknown {
  const lines = raw.split(/\r?\n/).map((line, index) => ({ line, number: index + 1 }));
  const meaningful = lines.filter(({ line }) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
  if (meaningful.length === 0) {
    return {};
  }
  const [value] = parseBlock(meaningful, 0, 0);
  return value;
}

interface Line {
  readonly line: string;
  readonly number: number;
}

function parseBlock(lines: readonly Line[], start: number, indent: number): [unknown, number] {
  const first = lines[start];
  if (first === undefined) {
    return [{}, start];
  }
  if (strippedIndent(first.line) !== indent) {
    throw new AlertConfigError(`YAML indent error on line ${String(first.number)}.`);
  }
  if (first.line.trimStart().startsWith('- ')) {
    return parseSequence(lines, start, indent);
  }
  return parseMapping(lines, start, indent);
}

function parseMapping(lines: readonly Line[], start: number, indent: number): [unknown, number] {
  const result: Record<string, unknown> = {};
  let index = start;

  while (index < lines.length) {
    const current = lines[index];
    if (current === undefined) {
      break;
    }
    const currentIndent = strippedIndent(current.line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      throw new AlertConfigError(`YAML indent error on line ${String(current.number)}.`);
    }
    if (current.line.trimStart().startsWith('- ')) {
      break;
    }

    const trimmed = current.line.trim();
    const separator = trimmed.indexOf(':');
    if (separator < 1) {
      throw new AlertConfigError(`YAML mapping expected on line ${String(current.number)}.`);
    }
    const key = unquote(trimmed.slice(0, separator).trim());
    const rest = trimmed.slice(separator + 1).trim();
    index += 1;

    if (rest !== '') {
      result[key] = parseScalar(rest);
      continue;
    }

    const next = lines[index];
    if (next === undefined || strippedIndent(next.line) <= indent) {
      result[key] = null;
      continue;
    }
    const [child, nextIndex] = parseBlock(lines, index, strippedIndent(next.line));
    result[key] = child;
    index = nextIndex;
  }

  return [result, index];
}

function parseSequence(lines: readonly Line[], start: number, indent: number): [unknown, number] {
  const result: unknown[] = [];
  let index = start;

  while (index < lines.length) {
    const current = lines[index];
    if (current === undefined) {
      break;
    }
    const currentIndent = strippedIndent(current.line);
    if (currentIndent < indent) {
      break;
    }
    if (currentIndent > indent) {
      throw new AlertConfigError(`YAML indent error on line ${String(current.number)}.`);
    }
    const trimmed = current.line.trim();
    if (!trimmed.startsWith('- ')) {
      break;
    }
    const rest = trimmed.slice(2).trim();
    index += 1;
    if (rest !== '' && !rest.endsWith(':')) {
      if (rest.includes(': ')) {
        const inline: Record<string, unknown> = {};
        const separator = rest.indexOf(':');
        inline[unquote(rest.slice(0, separator).trim())] = parseScalar(
          rest.slice(separator + 1).trim(),
        );
        const next = lines[index];
        if (next !== undefined && strippedIndent(next.line) > indent) {
          const [child, nextIndex] = parseMapping(lines, index, strippedIndent(next.line));
          if (isRecord(child)) {
            Object.assign(inline, child);
          }
          index = nextIndex;
        }
        result.push(inline);
        continue;
      }
      result.push(parseScalar(rest));
      continue;
    }

    const item: Record<string, unknown> = {};
    if (rest.endsWith(':')) {
      const key = unquote(rest.slice(0, -1).trim());
      const next = lines[index];
      if (next !== undefined && strippedIndent(next.line) > indent) {
        const [child, nextIndex] = parseBlock(lines, index, strippedIndent(next.line));
        item[key] = child;
        index = nextIndex;
      } else {
        item[key] = null;
      }
    }
    const next = lines[index];
    if (
      next !== undefined &&
      strippedIndent(next.line) > indent &&
      !next.line.trimStart().startsWith('- ')
    ) {
      const [child, nextIndex] = parseMapping(lines, index, strippedIndent(next.line));
      if (isRecord(child)) {
        Object.assign(item, child);
      }
      index = nextIndex;
    }
    result.push(item);
  }

  return [result, index];
}

function parseScalar(raw: string): unknown {
  if (raw === 'null' || raw === '~') {
    return null;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') {
      return [];
    }
    return inner.split(',').map((part) => parseScalar(part.trim()));
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  return raw;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function strippedIndent(line: string): number {
  const match = /^( *)/.exec(line);
  return match?.[1]?.length ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
