// src/lib/time.js
const DOW = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
const DOW_INDEX = Object.fromEntries(DOW.map((d, i) => [d, i]));

function asDate(input) {
  const d = (input instanceof Date) ? input : new Date(input);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`Invalid time value (got: ${String(input)})`);
  }
  return d;
}

function partsToMap(parts) {
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

// UTC ISO string for DB writes
export function nowUtcIso(now = new Date()) {
  return asDate(now).toISOString();
}

// Local “ISO-ish” string without offset (display/logging only)
export function nowInTzISO(tz, now = new Date()) {
  const d = asDate(now);
  const m = partsToMap(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d));

  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}:${m.second}`;
}

export function getPartsInTz(now, tz) {
  const d = asDate(now);

  const m = partsToMap(new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d));

  const dow = String(m.weekday || "").toUpperCase();
  const hhmm = `${m.hour}:${m.minute}`;

  if (!Object.prototype.hasOwnProperty.call(DOW_INDEX, dow)) {
    throw new Error(`Could not derive weekday in tz=${tz} from ${d.toISOString()}`);
  }

  return { dow, hhmm };
}

export function getWeekOf(tz, now = new Date()) {
  const d = asDate(now);

  const ymd = partsToMap(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d));

  const y = Number(ymd.year);
  const m = Number(ymd.month);
  const day = Number(ymd.day);

  const utc = new Date(Date.UTC(y, m - 1, day));

  const { dow } = getPartsInTz(d, tz);
  const idx = DOW_INDEX[dow];

  utc.setUTCDate(utc.getUTCDate() - idx);

  return utc.toISOString().slice(0, 10);
}

export function addDays(ymd, days) {
  // ymd = "YYYY-MM-DD"
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Validate YYYY-MM-DD string
export function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Format a Date to YYYY-MM-DD using UTC fields
export function utcDateStr(d) {
  return asDate(d).toISOString().slice(0, 10);
}