const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Formats a millisecond duration for people: `45 s`, `45 min`, `9 h`, `1 h 30 min`, `2 d`.
 *
 * Machine-readable graph fields keep raw millisecond numbers; this is only for prose that a person
 * reads (gap details, explanation summary, report text). Rounding happens before choosing a unit,
 * so 59_500 ms is `1 min` rather than `60 s`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return 'unknown';
  }

  const sign = ms < 0 ? '-' : '';
  const totalSeconds = Math.round(Math.abs(ms) / SECOND_MS);

  if (totalSeconds < 60) {
    return `${sign}${String(totalSeconds)} s`;
  }

  const totalMinutes = Math.round(Math.abs(ms) / MINUTE_MS);
  if (totalMinutes < 60) {
    return `${sign}${String(totalMinutes)} min`;
  }

  const totalHoursFromMinutes = Math.floor(totalMinutes / 60);
  if (totalHoursFromMinutes < 24) {
    const minutes = totalMinutes % 60;
    if (minutes === 0) {
      return `${sign}${String(totalHoursFromMinutes)} h`;
    }
    return `${sign}${String(totalHoursFromMinutes)} h ${String(minutes)} min`;
  }

  const totalHours = Math.round(Math.abs(ms) / HOUR_MS);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (hours === 0) {
    return `${sign}${String(days)} d`;
  }
  return `${sign}${String(days)} d ${String(hours)} h`;
}
