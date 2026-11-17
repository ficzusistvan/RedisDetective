import type { SnapshotUploadFile } from './push-snapshots.js';

const textEncoder = new TextEncoder();

/**
 * Bytes reserved for one multipart boundary.
 *
 * undici's boundary is about `----formdata-undici-` plus a short random suffix. Budgeting 80
 * characters makes the estimate larger than the body fetch will actually send, so a batch that
 * fits the estimate also fits the platform limit.
 */
const BOUNDARY_BUDGET = 80;

/** Closing `--boundary--\r\n`, using the same oversized boundary as each part. */
function closingBoundaryBytes(): number {
  return utf8Bytes(`--${'b'.repeat(BOUNDARY_BUDGET)}--\r\n`);
}

function partBytes(file: SnapshotUploadFile): number {
  const header =
    `--${'b'.repeat(BOUNDARY_BUDGET)}\r\n` +
    `Content-Disposition: form-data; name="snapshots"; filename="${file.name}"\r\n` +
    `Content-Type: application/json\r\n` +
    `\r\n`;
  return utf8Bytes(header) + utf8Bytes(file.contents) + utf8Bytes('\r\n');
}

/**
 * Estimated size of the multipart body `fetch` will send for these files.
 *
 * The figure includes framing, not just the JSON. Callers compare it with the upload cap so a
 * batch stays under the hosted function limit.
 */
export function estimateMultipartBodyBytes(files: readonly SnapshotUploadFile[]): number {
  let total = closingBoundaryBytes();
  for (const file of files) {
    total += partBytes(file);
  }
  return total;
}

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}
