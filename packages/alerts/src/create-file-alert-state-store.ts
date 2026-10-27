import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { ALERT_STATE_SCHEMA_VERSION } from './alert-defaults.js';
import type { AlertChannel } from './alert-channel.js';
import { isAlertChannel } from './alert-channel.js';
import { ALERT_FINDING_KINDS } from './alert-finding.js';
import type { AlertFinding, AlertFindingKind } from './alert-finding.js';
import { ALERT_STATUSES } from './alert-state-record.js';
import type { AlertStateRecord } from './alert-state-record.js';
import type { AlertStateStore } from './alert-state-store.js';

/**
 * JSON file of alert records. Writes go to a sibling temp file and are renamed into place
 * so a crash mid-write cannot leave a half-record that would re-fire on the next start.
 *
 * A missing or unreadable file is treated as empty state, not a crash: `watch` must keep
 * sampling. The caller logs the recovery.
 */
export function createFileAlertStateStore(filePath: string): AlertStateStore {
  return {
    describe: filePath,
    async load(): Promise<readonly AlertStateRecord[]> {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch (error) {
        if (isEnoent(error)) {
          return [];
        }
        throw error;
      }
      return parseAlertStateFile(raw);
    },
    async save(records: readonly AlertStateRecord[]): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      const body = `${JSON.stringify(
        { schemaVersion: ALERT_STATE_SCHEMA_VERSION, records },
        null,
        2,
      )}\n`;
      const tempPath = join(dirname(filePath), `.${Date.now().toString(36)}-${process.pid}.tmp`);
      await writeFile(tempPath, body, 'utf8');
      await rename(tempPath, filePath);
    },
  };
}

export class AlertStateFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertStateFileError';
  }
}

export function parseAlertStateFile(raw: string): readonly AlertStateRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new AlertStateFileError('Alert state file is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new AlertStateFileError('Alert state file must be an object.');
  }
  const records = parsed['records'];
  if (!Array.isArray(records)) {
    throw new AlertStateFileError('Alert state file is missing a records array.');
  }
  return records.map((entry, index) => parseRecord(entry, index));
}

function parseRecord(value: unknown, index: number): AlertStateRecord {
  if (!isRecord(value)) {
    throw new AlertStateFileError(`Alert state record ${String(index)} is not an object.`);
  }
  const status = value['status'];
  const kind = value['kind'];
  const channels = value['notifiedChannels'];
  if (typeof value['fingerprint'] !== 'string' || typeof value['dedupKey'] !== 'string') {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} is missing identity fields.`,
    );
  }
  if (typeof status !== 'string' || !isAlertStatus(status)) {
    throw new AlertStateFileError(`Alert state record ${String(index)} has an unknown status.`);
  }
  if (typeof kind !== 'string' || !isFindingKind(kind)) {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} has an unknown finding kind.`,
    );
  }
  if (
    !Array.isArray(channels) ||
    !channels.every((item) => typeof item === 'string' && isAlertChannel(item))
  ) {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} has invalid notifiedChannels.`,
    );
  }
  return {
    fingerprint: value['fingerprint'],
    dedupKey: typeof value['dedupKey'] === 'string' ? value['dedupKey'] : '',
    status,
    host: readString(value, 'host'),
    pattern: readString(value, 'pattern'),
    ruleId: readString(value, 'ruleId'),
    kind,
    firstFiredAt: readString(value, 'firstFiredAt'),
    lastNotifiedAt: readString(value, 'lastNotifiedAt'),
    lastResolvedAt: value['lastResolvedAt'] === null ? null : readString(value, 'lastResolvedAt'),
    notifiedChannels: channels.filter((item): item is AlertChannel => isAlertChannel(item)),
    lastFinding: parseLastFinding(value['lastFinding'], index),
  };
}

function parseLastFinding(value: unknown, index: number): AlertFinding | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value) || typeof value['kind'] !== 'string' || !isFindingKind(value['kind'])) {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} has an invalid lastFinding.`,
    );
  }
  const pattern = value['pattern'];
  if (typeof pattern !== 'string') {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} lastFinding is missing a pattern.`,
    );
  }
  switch (value['kind']) {
    case 'pattern-growth':
      return {
        kind: 'pattern-growth',
        pattern,
        bytesBefore: readFinite(value, 'bytesBefore', index),
        bytesAfter: readFinite(value, 'bytesAfter', index),
        bytesGrowth: readFinite(value, 'bytesGrowth', index),
        percentGrowth: optionalFinite(value['percentGrowth']),
        growthPercentThreshold: optionalFinite(value['growthPercentThreshold']),
        growthBytesThreshold: optionalFinite(value['growthBytesThreshold']),
      };
    case 'ttl-coverage-drop':
      return {
        kind: 'ttl-coverage-drop',
        pattern,
        ttlCoverageBefore: readFinite(value, 'ttlCoverageBefore', index),
        ttlCoverageAfter: readFinite(value, 'ttlCoverageAfter', index),
        dropPoints: readFinite(value, 'dropPoints', index),
        thresholdPoints: readFinite(value, 'thresholdPoints', index),
      };
    case 'new-untimed-pattern':
      return {
        kind: 'new-untimed-pattern',
        pattern,
        ttlCoverageAfter: readFinite(value, 'ttlCoverageAfter', index),
        estimatedBytes: readFinite(value, 'estimatedBytes', index),
        estimatedKeyCount: readFinite(value, 'estimatedKeyCount', index),
      };
  }
}

function readFinite(record: Record<string, unknown>, key: string, index: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AlertStateFileError(
      `Alert state record ${String(index)} lastFinding is missing ${key}.`,
    );
  }
  return value;
}

function optionalFinite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new AlertStateFileError(`Alert state record is missing ${key}.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAlertStatus(value: string): value is AlertStateRecord['status'] {
  return (ALERT_STATUSES as readonly string[]).includes(value);
}

function isFindingKind(value: string): value is AlertFindingKind {
  return (ALERT_FINDING_KINDS as readonly string[]).includes(value);
}

function isEnoent(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}
