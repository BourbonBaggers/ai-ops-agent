// tests/_helpers.mjs
import assert from "node:assert/strict";
// tests/_helpers.mjs
import fs from "node:fs";
import path from "node:path";



export const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:8787";

/**
 * Fetch wrapper that:
 * - asserts status
 * - tries to parse JSON
 * - includes better errors when things go sideways
 */
export async function fetchJson(path, { method = "GET", body, headers } = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const init = {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, init);
  const text = await res.text();

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json undefined if not JSON
  }

  return { res, text, json, url };
}

export function assertStatus({ res, text, url }, expectedStatus) {
  assert.equal(
    res.status,
    expectedStatus,
    `expected HTTP ${expectedStatus} from ${url}, got ${res.status}. body=${text}`
  );
}

export function assertJsonBody({ res, text, json, url }) {
  assert.ok(
    res.headers.get("content-type")?.includes("application/json"),
    `expected JSON content-type from ${url}. content-type=${res.headers.get("content-type")} body=${text}`
  );
  assert.ok(json && typeof json === "object", `expected JSON body from ${url}. body=${text}`);
  return json;
}

// Overloads supported:
//   getJson(path)
//   getJson(path, expectedStatus)
//   getJson(path, opts)
//   getJson(path, opts, expectedStatus)
export async function getJson(path, arg2, arg3) {
  let opts = {};
  let expectedStatus = 200;

  if (typeof arg2 === "number") {
    expectedStatus = arg2;
  } else if (arg2 && typeof arg2 === "object") {
    opts = arg2;
    if (typeof arg3 === "number") expectedStatus = arg3;
  }

  const r = await fetchJson(path, opts);
  assertStatus(r, expectedStatus);
  return assertJsonBody(r);
}

// Overloads supported:
//   postJson(path, body)
//   postJson(path, body, expectedStatus)
//   postJson(path, body, opts)
//   postJson(path, body, opts, expectedStatus)
export async function postJson(path, body, arg3, arg4) {
  let opts = {};
  let expectedStatus = 200;

  if (typeof arg3 === "number") {
    expectedStatus = arg3;
  } else if (arg3 && typeof arg3 === "object") {
    opts = arg3;
    if (typeof arg4 === "number") expectedStatus = arg4;
  }

  const r = await fetchJson(path, { ...opts, method: "POST", body });
  assertStatus(r, expectedStatus);
  return assertJsonBody(r);
}
// ---------------------------------------------------------------------------
// Schedule / tick helpers — shared by idempotency and preview tests
// ---------------------------------------------------------------------------

function _ymdToDateUtc(ymd) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function _addDaysYmd(ymd, days) {
  const d = _ymdToDateUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function _normalizeDowToken(x) {
  if (x === null || x === undefined) return "";
  const s = String(x).trim().toLowerCase();
  if (!s) return "";
  if (/^\d+$/.test(s)) return s;
  return s.slice(0, 3);
}

function _weekdayShortInTz(ymd, tz) {
  const dt = new Date(`${ymd}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(dt);
}

function _hhmmInTz(date, tz) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
  }).format(date);
}

function _ymdInTz(date, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz,
  }).format(date);
}

/**
 * Given a week_of (YYYY-MM-DD Monday) and a schedule DOW token (e.g. "fri", "FRIDAY", "5"),
 * return the YYYY-MM-DD of the day in that week matching the DOW, in the given tz.
 */
export function findDateInWeekMatchingDow(weekOfYmd, scheduleDow, tz) {
  const want = _normalizeDowToken(scheduleDow);
  const weekdayToNumSun0 = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  for (let i = 0; i < 7; i++) {
    const ymd = _addDaysYmd(weekOfYmd, i);
    const short = _normalizeDowToken(_weekdayShortInTz(ymd, tz));
    if (want === short) return ymd;
    if (/^\d+$/.test(want) && String(weekdayToNumSun0[short]) === want) return ymd;
  }

  throw new Error(`Could not find a date in week_of=${weekOfYmd} matching schedule dow=${scheduleDow}`);
}

/**
 * Convert a desired local time (ymd + hhmm in tz) to a UTC ISO string.
 * Iteratively adjusts to handle DST without requiring hardcoded offsets.
 */
export function localYmdHhmmToUtcIso(ymd, hhmm, tz) {
  const [hh, mm] = hhmm.split(":").map(n => parseInt(n, 10));
  let guess = new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`);

  for (let i = 0; i < 12; i++) {
    if (_ymdInTz(guess, tz) === ymd && _hhmmInTz(guess, tz) === hhmm) return guess.toISOString();

    let bestDeltaMin = null;
    for (const deltaMin of [-720, -360, -180, -120, -60, -30, -15, -5, -1, 1, 5, 15, 30, 60, 120, 180, 360, 720]) {
      const trial = new Date(guess.getTime() + deltaMin * 60_000);
      if (_ymdInTz(trial, tz) === ymd && _hhmmInTz(trial, tz) === hhmm) return trial.toISOString();
      if (_ymdInTz(trial, tz) === ymd) {
        const t = _hhmmInTz(trial, tz);
        const diff = Math.abs((parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10)) - (hh * 60 + mm));
        if (bestDeltaMin === null || diff < bestDeltaMin.diff) bestDeltaMin = { deltaMin, diff };
      }
    }

    guess = bestDeltaMin
      ? new Date(guess.getTime() + bestDeltaMin.deltaMin * 60_000)
      : new Date(guess.getTime() + 6 * 60 * 60_000);
  }

  throw new Error(`Failed to compute UTC ISO for local ${ymd} ${hhmm} in tz=${tz}`);
}

// ---------------------------------------------------------------------------

/**
 * Convenience for endpoints that accept query strings.
 */
export function qs(params = {}) {
  const u = new URL("http://x");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  const s = u.searchParams.toString();
  return s ? `?${s}` : "";
}