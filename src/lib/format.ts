/** Shift starts at 08:00. clock is minutes since shift start. */
export const SHIFT_START = 8 * 60;

export function fmtClock(minutes: number): string {
  const total = SHIFT_START + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = Math.floor(total % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtSla(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtShort(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function fmtAgo(now: number, then: number): string {
  const diff = Math.max(0, now - then);
  return `${fmtShort(diff)} ago`;
}

export function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export function fmtMoney(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}
