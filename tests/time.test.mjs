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
  sendWeekOf,
  nextSendDateYmd,
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

// --- sendWeekOf ---
// The key invariant: Friday Mar 13 and Tuesday Mar 17 must both return "2026-03-16"
// (the Monday of the send week) so they resolve to the same weekly_run row.

// 2026-03-13T15:00:00Z = Friday 09:00 CST (UTC-6)
test("sendWeekOf: Friday returns NEXT Monday (send week not current week)", () => {
  const d = new Date("2026-03-13T15:00:00Z"); // Fri 09:00 CST
  assert.equal(sendWeekOf("America/Chicago", d, "TUESDAY"), "2026-03-16");
});

// 2026-03-17T15:00:00Z = Tuesday 10:00 CDT (UTC-5, DST started Mar 8)
test("sendWeekOf: Tuesday returns THIS Monday (same send week)", () => {
  const d = new Date("2026-03-17T15:00:00Z"); // Tue 10:00 CDT
  assert.equal(sendWeekOf("America/Chicago", d, "TUESDAY"), "2026-03-16");
});

// Monday is before Tuesday so it belongs to the same send week
test("sendWeekOf: Monday returns THIS Monday (same send week)", () => {
  const d = new Date("2026-03-16T15:00:00Z"); // Mon 10:00 CDT
  assert.equal(sendWeekOf("America/Chicago", d, "TUESDAY"), "2026-03-16");
});

// Wednesday is past Tuesday so it targets next week's send
test("sendWeekOf: Wednesday returns NEXT Monday (send day already passed)", () => {
  const d = new Date("2026-03-18T15:00:00Z"); // Wed 10:00 CDT
  assert.equal(sendWeekOf("America/Chicago", d, "TUESDAY"), "2026-03-23");
});

// Cross-week DST boundary: US DST starts 2026-03-08. Ensure Friday before DST still works.
test("sendWeekOf: Friday before DST boundary returns correct next Monday", () => {
  const d = new Date("2026-03-06T15:00:00Z"); // Fri 09:00 CST (DST starts Mar 8)
  assert.equal(sendWeekOf("America/Chicago", d, "TUESDAY"), "2026-03-09");
});

// --- nextSendDateYmd ---

test("nextSendDateYmd: Friday returns next Tuesday", () => {
  const d = new Date("2026-03-13T15:00:00Z"); // Fri 09:00 CST
  assert.equal(nextSendDateYmd("America/Chicago", d, "TUESDAY"), "2026-03-17");
});

test("nextSendDateYmd: Tuesday returns same Tuesday", () => {
  const d = new Date("2026-03-17T15:00:00Z"); // Tue 10:00 CDT
  assert.equal(nextSendDateYmd("America/Chicago", d, "TUESDAY"), "2026-03-17");
});

test("nextSendDateYmd: Monday returns the very next day (Tuesday)", () => {
  const d = new Date("2026-03-16T15:00:00Z"); // Mon 10:00 CDT
  assert.equal(nextSendDateYmd("America/Chicago", d, "TUESDAY"), "2026-03-17");
});

test("nextSendDateYmd: Wednesday returns the following Tuesday", () => {
  const d = new Date("2026-03-18T15:00:00Z"); // Wed 10:00 CDT
  assert.equal(nextSendDateYmd("America/Chicago", d, "TUESDAY"), "2026-03-24");
});

// --- sendWeekOf + nextSendDateYmd consistency ---
// Core invariant: a Friday generate and the following Tuesday send must
// resolve to the same week_of anchor, proving the bug is fixed.

test("sendWeekOf consistency: Friday generate and following Tuesday send share same week_of", () => {
  const friday = new Date("2026-03-13T15:00:00Z"); // Fri 09:00 CST
  const tuesday = new Date("2026-03-17T15:00:00Z"); // Tue 10:00 CDT

  const fridayWeekOf = sendWeekOf("America/Chicago", friday, "TUESDAY");
  const tuesdayWeekOf = sendWeekOf("America/Chicago", tuesday, "TUESDAY");

  assert.equal(fridayWeekOf, tuesdayWeekOf,
    `Friday week_of (${fridayWeekOf}) must match Tuesday week_of (${tuesdayWeekOf})`);
  assert.equal(fridayWeekOf, "2026-03-16");
});

test("nextSendDateYmd consistency: Friday and Monday both resolve to same Tuesday", () => {
  const friday = new Date("2026-03-13T15:00:00Z");
  const monday = new Date("2026-03-16T15:00:00Z");
  const tuesday = new Date("2026-03-17T15:00:00Z");

  assert.equal(nextSendDateYmd("America/Chicago", friday, "TUESDAY"), "2026-03-17");
  assert.equal(nextSendDateYmd("America/Chicago", monday, "TUESDAY"), "2026-03-17");
  assert.equal(nextSendDateYmd("America/Chicago", tuesday, "TUESDAY"), "2026-03-17");
});

// --- nowInTzISO ---

test("nowInTzISO: returns local ISO-ish string without offset", () => {
  const d = new Date("2026-02-20T15:00:00Z"); // Fri 09:00 CST
  const s = nowInTzISO("America/Chicago", d);
  // Should look like 2026-02-20T09:00:00 (no Z, no offset)
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.equal(s, "2026-02-20T09:00:00");
});
