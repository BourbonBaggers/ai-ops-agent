// tests/time.test.mjs — pure unit tests, no server required
import test from "node:test";
import assert from "node:assert/strict";
import {
  nowUtcIso,
  nowInTzISO,
  getPartsInTz,
  getWeekOf,
  addDays,
  isYmd,
  utcDateStr,
} from "../src/lib/time.js";

// --- isYmd ---

test("isYmd: accepts valid YYYY-MM-DD", () => {
  assert.equal(isYmd("2026-02-16"), true);
  assert.equal(isYmd("2000-01-01"), true);
});

test("isYmd: rejects non-strings and malformed values", () => {
  assert.equal(isYmd(null), false);
  assert.equal(isYmd(undefined), false);
  assert.equal(isYmd(20260216), false);
  assert.equal(isYmd("2026-2-6"), false);     // not zero-padded
  assert.equal(isYmd("2026/02/16"), false);   // wrong separator
  assert.equal(isYmd("not-a-date"), false);
});

// --- addDays ---

test("addDays: adds positive days across a month boundary", () => {
  assert.equal(addDays("2026-01-28", 7), "2026-02-04");
});

test("addDays: adds 0 days returns same date", () => {
  assert.equal(addDays("2026-02-16", 0), "2026-02-16");
});

test("addDays: subtracts days with negative value", () => {
  assert.equal(addDays("2026-02-16", -1), "2026-02-15");
});

// --- utcDateStr ---

test("utcDateStr: extracts YYYY-MM-DD from a Date", () => {
  assert.equal(utcDateStr(new Date("2026-02-20T15:30:00Z")), "2026-02-20");
});

test("utcDateStr: accepts ISO string input", () => {
  assert.equal(utcDateStr("2026-02-20T00:00:00Z"), "2026-02-20");
});

test("utcDateStr: throws on invalid input", () => {
  assert.throws(() => utcDateStr("not-a-date"), RangeError);
});

// --- nowUtcIso ---

test("nowUtcIso: returns ISO string ending in Z", () => {
  const s = nowUtcIso();
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$/);
});

test("nowUtcIso: accepts a Date override", () => {
  const d = new Date("2026-02-20T15:00:00.000Z");
  assert.equal(nowUtcIso(d), "2026-02-20T15:00:00.000Z");
});

// --- getPartsInTz ---
// 2026-02-20T15:00:00Z = Friday 09:00 CST (UTC-6, America/Chicago in Feb)

test("getPartsInTz: Friday 09:00 CST", () => {
  const d = new Date("2026-02-20T15:00:00Z");
  const { dow, hhmm } = getPartsInTz(d, "America/Chicago");
  assert.equal(dow, "FRIDAY");
  assert.equal(hhmm, "09:00");
});

// 2026-02-23T15:00:00Z = Monday 09:00 CST
test("getPartsInTz: Monday 09:00 CST", () => {
  const d = new Date("2026-02-23T15:00:00Z");
  const { dow, hhmm } = getPartsInTz(d, "America/Chicago");
  assert.equal(dow, "MONDAY");
  assert.equal(hhmm, "09:00");
});

// 2026-02-22T20:00:00Z = Sunday 14:00 CST
test("getPartsInTz: Sunday 14:00 CST", () => {
  const d = new Date("2026-02-22T20:00:00Z");
  const { dow, hhmm } = getPartsInTz(d, "America/Chicago");
  assert.equal(dow, "SUNDAY");
  assert.equal(hhmm, "14:00");
});

// --- getWeekOf ---
// Week-of returns the Monday of the current local week.
// 2026-02-20 is a Friday -> week_of = 2026-02-16 (Monday)

test("getWeekOf: Friday returns preceding Monday", () => {
  const d = new Date("2026-02-20T15:00:00Z"); // Fri 09:00 CST
  assert.equal(getWeekOf("America/Chicago", d), "2026-02-16");
});

// 2026-02-23T15:00:00Z = Monday 09:00 CST -> week_of = 2026-02-23 itself
test("getWeekOf: Monday returns that same Monday", () => {
  const d = new Date("2026-02-23T15:00:00Z");
  assert.equal(getWeekOf("America/Chicago", d), "2026-02-23");
});

// Sunday 14:00 CST 2026-02-22 still belongs to week starting 2026-02-16
test("getWeekOf: Sunday returns the Monday that started the week", () => {
  const d = new Date("2026-02-22T20:00:00Z"); // Sun 14:00 CST
  assert.equal(getWeekOf("America/Chicago", d), "2026-02-16");
});

// --- nowInTzISO ---

test("nowInTzISO: returns local ISO-ish string without offset", () => {
  const d = new Date("2026-02-20T15:00:00Z"); // Fri 09:00 CST
  const s = nowInTzISO("America/Chicago", d);
  // Should look like 2026-02-20T09:00:00 (no Z, no offset)
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(s, "2026-02-20T09:00:00");
});
