import { estimateMultipartBodyBytes } from './estimate-upload-bytes.js';
import type { SnapshotUploadFile } from './push-snapshots.js';

export interface OversizedUploadFile {
  readonly name: string;
  /** Estimated multipart body if this file were posted alone. */
  readonly bytes: number;
}

export interface PackedSnapshotBatches {
  readonly batches: readonly (readonly SnapshotUploadFile[])[];
  readonly oversized: readonly OversizedUploadFile[];
}

/**
 * Splits files into POST bodies that each fit `maxBytes`.
 *
 * A file that cannot fit alone is returned in `oversized` and is not placed in a batch. Sending
 * it would be rejected by the platform, and splitting one snapshot JSON is not a valid upload.
 */
export function packSnapshotBatches(
  files: readonly SnapshotUploadFile[],
  maxBytes: number,
): PackedSnapshotBatches {
  const batches: SnapshotUploadFile[][] = [];
  const oversized: OversizedUploadFile[] = [];
  let current: SnapshotUploadFile[] = [];

  for (const file of files) {
    const alone = estimateMultipartBodyBytes([file]);
    if (alone > maxBytes) {
      oversized.push({ name: file.name, bytes: alone });
      continue;
    }

    if (current.length > 0 && estimateMultipartBodyBytes([...current, file]) > maxBytes) {
      batches.push(current);
      current = [file];
      continue;
    }

    current.push(file);
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return { batches, oversized };
}
