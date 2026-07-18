/**
 * cronUtils — tiny, dependency-free 5-field cron helpers used only for the
 * Schedule node's config-panel preview (humanized description + next 5 run
 * times). Not used by the worker/scheduler — apps/api/src/utils/scheduler.ts
 * still owns real cron evaluation (via BullMQ's repeat pattern), so this file
 * only needs to be "good enough" for a friendly UI preview.
 */

const FIELD_RANGES: Array<[min: number, max: number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

function parseField(raw: string, min: number, max: number): number[] | null {
  const values = new Set<number>();
  for (const part of raw.split(',')) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    const step = m[3] ? Number(m[3]) : 1;
    if (!Number.isFinite(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (m[1] !== '*') {
      start = Number(m[1]);
      end = m[2] !== undefined ? Number(m[2]) : m[3] ? max : start;
    }
    if (start < min || end > max || start > end) return null;
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

export interface ParsedCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/** Returns null if the cron string doesn't have exactly 5 whitespace-separated fields, or a field fails to parse. */
export function parseCron(cron: string): ParsedCron | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((p, i) => parseField(p, ...FIELD_RANGES[i]));
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

export function isValidCron(cron: string): boolean {
  return parseCron(cron) !== null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Best-effort humanized description — covers common patterns, falls back to a field-by-field summary. */
export function describeCron(cron: string): string {
  const parsed = parseCron(cron);
  if (!parsed) return 'Invalid cron expression';
  const { minute, hour, dayOfMonth, month, dayOfWeek } = parsed;
  const isEvery = (arr: number[], min: number, max: number) => arr.length === max - min + 1;
  const step = (arr: number[]) => (arr.length > 1 ? arr[1] - arr[0] : 0) || 0;
  const isEveryStep = (arr: number[], min: number, max: number) => {
    const s = step(arr);
    if (s === 0) return false;
    for (let i = 0; i < arr.length; i++) if (arr[i] !== min + i * s) return false;
    return arr[arr.length - 1] + s > max;
  };

  const domAll = isEvery(dayOfMonth, 1, 31);
  const monthAll = isEvery(month, 1, 12);
  const dowAll = isEvery(dayOfWeek, 0, 6);

  if (isEvery(minute, 0, 59) && isEvery(hour, 0, 23) && domAll && monthAll && dowAll) {
    return 'Every minute';
  }
  if (minute.length === 1 && isEveryStep(hour, 0, 23) === false && isEvery(hour, 0, 23) && domAll && monthAll && dowAll) {
    return `Every hour, at minute ${minute[0]}`;
  }
  if (isEveryStep(minute, 0, 59) && isEvery(hour, 0, 23) && domAll && monthAll && dowAll) {
    return `Every ${step(minute)} minutes`;
  }
  if (minute.length === 1 && isEveryStep(hour, 0, 23) && domAll && monthAll && dowAll) {
    return `Every ${step(hour)} hours, at minute ${minute[0]}`;
  }
  if (minute.length === 1 && hour.length === 1 && domAll && monthAll && dowAll) {
    return `Every day at ${pad(hour[0])}:${pad(minute[0])}`;
  }
  if (minute.length === 1 && hour.length === 1 && domAll && monthAll && !dowAll) {
    const days = dayOfWeek.map((d) => DAY_NAMES[d]).join(', ');
    return `At ${pad(hour[0])}:${pad(minute[0])}, on ${days}`;
  }
  if (minute.length === 1 && hour.length === 1 && !domAll && monthAll && dowAll) {
    const days = dayOfMonth.join(', ');
    return `At ${pad(hour[0])}:${pad(minute[0])}, on day ${days} of the month`;
  }
  if (minute.length === 1 && hour.length === 1 && domAll && !monthAll && dowAll) {
    const months = month.map((m) => MONTH_NAMES[m]).join(', ');
    return `At ${pad(hour[0])}:${pad(minute[0])}, in ${months}`;
  }
  return `At minute ${minute.join(',')}, hour ${hour.join(',')}, day-of-month ${dayOfMonth.join(',')}, month ${month.join(',')}, weekday ${dayOfWeek.join(',')}`;
}

/** Returns up to `count` upcoming fire times, scanning minute-by-minute (capped so it can't hang on impossible patterns like Feb 30). */
export function nextRuns(cron: string, count = 5, from: Date = new Date()): Date[] {
  const parsed = parseCron(cron);
  if (!parsed) return [];
  const results: Date[] = [];
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 60 * 24 * 366 * 2; // scan up to ~2 years of minutes
  for (let i = 0; i < maxIterations && results.length < count; i++, cursor.setMinutes(cursor.getMinutes() + 1)) {
    if (!parsed.minute.includes(cursor.getMinutes())) continue;
    if (!parsed.hour.includes(cursor.getHours())) continue;
    if (!parsed.month.includes(cursor.getMonth() + 1)) continue;
    // Standard cron OR semantics when both day-of-month and day-of-week are restricted.
    const domRestricted = parsed.dayOfMonth.length !== 31;
    const dowRestricted = parsed.dayOfWeek.length !== 7;
    const domMatch = parsed.dayOfMonth.includes(cursor.getDate());
    const dowMatch = parsed.dayOfWeek.includes(cursor.getDay());
    if (domRestricted && dowRestricted ? !(domMatch || dowMatch) : !(domMatch && dowMatch)) continue;
    results.push(new Date(cursor));
  }
  return results;
}
