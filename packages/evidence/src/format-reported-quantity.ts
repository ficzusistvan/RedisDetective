const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * Binary size for a sentence a person reads.
 *
 * Whole numbers stay whole (`8 MiB`, `40 MiB`). A fractional mebibyte or gibibyte keeps one decimal
 * (`46.9 MiB`). Raw byte counts do not belong in that sentence.
 */
export function formatBinaryMagnitude(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= GIB) {
    return `${trimOneDecimal(abs / GIB)} GiB`;
  }
  if (abs >= MIB) {
    return `${trimOneDecimal(abs / MIB)} MiB`;
  }
  if (abs >= KIB) {
    return `${trimOneDecimal(abs / KIB)} KiB`;
  }
  const whole = String(Math.round(abs));
  return abs === 1 ? `${whole} byte` : `${whole} bytes`;
}

/**
 * A ratio rendered as a percent. `0.02` is `2%`; `0.0517` is `5.2%`.
 */
export function formatRatioPercent(ratio: number): string {
  const percent = Math.round(Math.abs(ratio) * 1000) / 10;
  return `${trimOneDecimal(percent)}%`;
}

/**
 * `2026-11-14T03:30:00.000Z` becomes `2026-11-14 03:30 UTC`.
 *
 * Seconds are kept only when they are not zero, so a timestamp that is actually on the minute does
 * not grow a `:00`. A string that is not a UTC instant is returned unchanged: inventing a clock
 * reading would be worse than showing the original.
 */
export function formatUtcInstant(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/.exec(iso);
  const date = match?.[1];
  const hours = match?.[2];
  const minutes = match?.[3];
  const seconds = match?.[4];
  if (date === undefined || hours === undefined || minutes === undefined) {
    return iso;
  }
  const clock =
    seconds === undefined || seconds === '00'
      ? `${hours}:${minutes}`
      : `${hours}:${minutes}:${seconds}`;
  return `${date} ${clock} UTC`;
}

function trimOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
