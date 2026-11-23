/**
 * Local-time formatting — pure, no DOM.
 *
 * Records are stored as ISO-8601 UTC strings. The UI used to print the raw
 * UTC slice of them ("19:17" for a capture made at 03:17 local), which reads
 * like a bug to anyone east of London. Everything time-shaped in the UI goes
 * through these helpers: local wall-clock time plus an explicit zone label.
 */

export interface LocalDateTime {
  /** "04:34" — 24h, local wall clock */
  time: string;
  /** "Nov 24" — local calendar date */
  date: string;
  /** "2026-11-24" — local calendar date, numeric */
  dateNum: string;
  /** "04:34:11" */
  timeSec: string;
  /** "UTC+8" / "UTC-5" / "UTC+5:30" — the zone the times above are expressed in */
  zone: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Wall-clock fields of `date` in `timeZone` (IANA name; omitted = this device's zone). */
function wallClock(date: Date, timeZone?: string): WallClock | null {
  try {
    const opts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23", // not hour12:false — that prints "24" for midnight in some engines
    };
    if (timeZone) opts.timeZone = timeZone;
    const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const w = { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
    return Object.values(w).every(Number.isFinite) ? w : null;
  } catch {
    return null;
  }
}

/** Zone offset from UTC, in minutes, at the instant `date` (positive = ahead of UTC). */
function offsetMinutes(date: Date, timeZone?: string): number {
  if (!timeZone) return -date.getTimezoneOffset();
  const w = wallClock(date, timeZone);
  if (!w) return -date.getTimezoneOffset();
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

function zoneLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ":" + String(m).padStart(2, "0") : ""}`;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local wall-clock breakdown of an ISO-8601 instant. Never throws. */
export function localDateTime(iso: string, timeZone?: string): LocalDateTime {
  const date = new Date(iso);
  const invalid: LocalDateTime = { time: "—", date: "", dateNum: "", timeSec: "—", zone: "" };
  if (Number.isNaN(date.getTime())) return invalid;
  const w = wallClock(date, timeZone);
  if (!w) {
    // Intl unavailable: show the stored UTC explicitly labelled as such.
    return { time: iso.slice(11, 16), date: "", dateNum: iso.slice(0, 10), timeSec: iso.slice(11, 19), zone: "UTC" };
  }
  return {
    time: `${pad(w.h)}:${pad(w.mi)}`,
    date: `${MONTHS[w.mo - 1]} ${w.d}`,
    dateNum: `${w.y}-${pad(w.mo)}-${pad(w.d)}`,
    timeSec: `${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`,
    zone: zoneLabel(offsetMinutes(date, timeZone)),
  };
}

/** "Nov 24, 04:34 (UTC+8)" — for record cards. */
export function formatRecordTime(iso: string, timeZone?: string): string {
  const t = localDateTime(iso, timeZone);
  return t.date ? `${t.date}, ${t.time} (${t.zone})` : "—";
}

/** "04:34:11" — for the engine log (the zone is printed once in the log header). */
export function formatLogTime(iso: string, timeZone?: string): string {
  return localDateTime(iso, timeZone).timeSec;
}

/** The zone label for right now, e.g. "UTC+8". */
export function zoneLabelNow(timeZone?: string): string {
  return localDateTime(new Date().toISOString(), timeZone).zone;
}
