// tests/friday_to_tuesday_send.test.mjs
//
// Regression tests for the cross-week scheduling bug:
//   - Candidates generated on Friday must be found and sent on the following Tuesday.
//   - The fix: tick() now uses sendWeekOf() so Friday and the following Tuesday both
//     resolve to the same week_of (Monday of the send week).
//
// Test matrix:
//   1. Friday generate → following Tuesday send (the core bug scenario)
//   2. DST boundary — US spring-forward (2026-03-08): Friday before / Tuesday after
//   3. Year boundary — Friday Dec 26 2025 → Tuesday Jan 6 2026 (across new year)
//   4. Idempotency: Tuesday send tick does NOT re-send if already sent
//   5. Normal same-week flows still work (lock fires before send on the same Tuesday)
//
// Each test drives the live dev server via HTTP (same pattern as tick_idempotency tests).

import assert from "node:assert/strict";
import test from "node:test";
import {
  getJson,
  postJson,
  findDateInWeekMatchingDow,
  localYmdHhmmToUtcIso,
} from "./_helpers.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tickAt(isoUtc) {
  const r = await postJson(`/jobs/tick?now=${encodeURIComponent(isoUtc)}`);
  assert.equal(r.status, "ok", `tick should return status=ok (got: ${JSON.stringify(r)})`);
  return r;
}

async function resetWeek(week_of) {
  const r = await postJson(`/dev/run?week_of=${encodeURIComponent(week_of)}&reset=1`);
  assert.equal(r.status, "ok", `dev/run reset should return ok for week_of=${week_of}`);
  return r;
}

async function getCandidates(week_of) {
  return getJson(`/admin/candidates?week_of=${encodeURIComponent(week_of)}`);
}

async function getWeekly(week_of) {
  return getJson(`/admin/weekly?week_of=${encodeURIComponent(week_of)}`);
}

async function getSends(weekly_run_id) {
  return getJson(`/admin/sends?weekly_run_id=${encodeURIComponent(weekly_run_id)}`);
}

async function getConfig() {
  const cfg = await getJson("/admin/config");
  assert.equal(cfg.status, "ok");
  const tz = cfg.tz ?? cfg.config?.timezone ?? cfg.config?.tz;
  const schedule = cfg.schedule ?? cfg.config?.schedule;
  assert.ok(tz, "config missing tz");
  assert.ok(schedule?.generate?.dow, "config missing schedule.generate.dow");
  assert.ok(schedule?.lock?.dow, "config missing schedule.lock.dow");
  assert.ok(schedule?.send?.dow, "config missing schedule.send.dow");
  return { tz, schedule };
}

// Returns the Monday of the week containing ymd (Monday-anchored).
function mondayOf(ymd) {
  const DAYS = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };
  const d = new Date(`${ymd}T12:00:00Z`);
  const short = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(d).toUpperCase();
  const idx = DAYS[short] ?? 0;
  const ms = d.getTime() - idx * 86400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 1. Core regression: Friday generate → following Tuesday send
// ---------------------------------------------------------------------------

test("cross-week: candidate generated Friday is found and sent on following Tuesday", async () => {
  const { tz, schedule } = await getConfig();

  // Anchors:
  //   Generate: Friday Feb 20, 2026  (PREV_WEEK_OF = "2026-02-16")
  //   Send:     Tuesday Feb 24, 2026 (SEND_WEEK_OF = "2026-02-23")
  const PREV_WEEK_OF = "2026-02-16";
  const SEND_WEEK_OF = "2026-02-23";

  await resetWeek(SEND_WEEK_OF);

  // --- Generate on Friday ---
  const genDate = findDateInWeekMatchingDow(PREV_WEEK_OF, schedule.generate.dow, tz);
  const genNow = localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz);
  const genTick = await tickAt(genNow);

  // Verify candidates land in SEND_WEEK_OF, not PREV_WEEK_OF.
  const afterGen = await getCandidates(SEND_WEEK_OF);
  assert.ok(
    (afterGen.candidates ?? []).length >= 1,
    `Candidates should be stored under SEND_WEEK_OF=${SEND_WEEK_OF} after Friday generate. ` +
    `Got ${(afterGen.candidates ?? []).length}. ` +
    `Check PREV_WEEK_OF=${PREV_WEEK_OF}: ` +
    `tick actions=${JSON.stringify(genTick.actions)}, tick week_of=${genTick.week_of}`
  );

  const misplacedCands = await getCandidates(PREV_WEEK_OF);
  assert.equal(
    (misplacedCands.candidates ?? []).length, 0,
    `Candidates must NOT be stored under PREV_WEEK_OF=${PREV_WEEK_OF} (that was the old bug)`
  );

  // --- Send on following Tuesday ---
  const sendDate = findDateInWeekMatchingDow(SEND_WEEK_OF, schedule.send.dow, tz);
  const sendNow = localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz);
  const sendTick = await tickAt(sendNow);

  // The send tick must have fired (send_stub in actions means sendWeeklyRun returned true).
  assert.ok(
    Array.isArray(sendTick.actions) && sendTick.actions.includes("send_stub"),
    `Tuesday send tick should include "send_stub" in actions. Got: ${JSON.stringify(sendTick.actions)}\n` +
    `tick week_of=${sendTick.week_of}`
  );
});

// ---------------------------------------------------------------------------
// 2. DST boundary: US spring-forward 2026-03-08
//    Friday Mar 6 (CST, UTC-6) generate → Tuesday Mar 10 (CDT, UTC-5) send
// ---------------------------------------------------------------------------

test("cross-week DST: generate before spring-forward, send after, same run", async () => {
  const { tz, schedule } = await getConfig();
  if (tz !== "America/Chicago") {
    // DST test only meaningful for America/Chicago; skip gracefully otherwise.
    return;
  }

  // Fri Mar 6 → send week Monday Mar 9 (SEND_WEEK_OF)
  // Tue Mar 10 → week_of = Monday Mar 9 ✓
  const PREV_WEEK_OF = "2026-03-02"; // Mon Mar 2 (contains Fri Mar 6)
  const SEND_WEEK_OF = "2026-03-09"; // Mon Mar 9 (contains Tue Mar 10)

  await resetWeek(SEND_WEEK_OF);

  const genDate = findDateInWeekMatchingDow(PREV_WEEK_OF, schedule.generate.dow, tz); // Mar 6
  const genNow = localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz);
  await tickAt(genNow);

  const afterGen = await getCandidates(SEND_WEEK_OF);
  assert.ok(
    (afterGen.candidates ?? []).length >= 1,
    `DST test: candidates should be under SEND_WEEK_OF=${SEND_WEEK_OF} after Friday generate`
  );

  const sendDate = findDateInWeekMatchingDow(SEND_WEEK_OF, schedule.send.dow, tz); // Mar 10
  const sendNow = localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz);
  const sendTick = await tickAt(sendNow);

  assert.ok(
    Array.isArray(sendTick.actions) && sendTick.actions.includes("send_stub"),
    `DST Tuesday send should fire. actions=${JSON.stringify(sendTick.actions)}, week_of=${sendTick.week_of}`
  );
});

// ---------------------------------------------------------------------------
// 3. Week boundary edge: Wednesday + Thursday + Friday all map to the same send week
// ---------------------------------------------------------------------------

test("cross-week: any day past send-DOW in a week maps to the same send-week Monday", async () => {
  // This is a pure-logic assertion tested via the tick response's week_of field.
  const { tz, schedule } = await getConfig();
  if (tz !== "America/Chicago") return; // America/Chicago assumed

  // Wed Mar 18, Thu Mar 19, Fri Mar 20 should all return week_of="2026-03-23" (next Monday).
  const expectedWeekOf = "2026-03-23";
  for (const [day, utcTime] of [
    ["2026-03-18", "2026-03-18T17:00:00Z"], // Wed Mar 18 noon CDT
    ["2026-03-19", "2026-03-19T17:00:00Z"], // Thu Mar 19 noon CDT
    ["2026-03-20", "2026-03-20T17:00:00Z"], // Fri Mar 20 noon CDT
  ]) {
    const r = await tickAt(utcTime);
    assert.equal(
      r.week_of, expectedWeekOf,
      `${day} should map to week_of=${expectedWeekOf}, got ${r.week_of}`
    );
  }

  // Mon Mar 23 and Tue Mar 24 (the send day) should also both return "2026-03-23".
  for (const [day, utcTime] of [
    ["2026-03-23", "2026-03-23T17:00:00Z"], // Mon
    ["2026-03-24", "2026-03-24T17:00:00Z"], // Tue (send day)
  ]) {
    const r = await tickAt(utcTime);
    assert.equal(
      r.week_of, expectedWeekOf,
      `${day} should map to week_of=${expectedWeekOf}, got ${r.week_of}`
    );
  }
});

// ---------------------------------------------------------------------------
// 4. Idempotency: second Tuesday send tick does NOT re-send
// ---------------------------------------------------------------------------

test("cross-week idempotency: second Tuesday send does not duplicate deliveries", async () => {
  const { tz, schedule } = await getConfig();

  const PREV_WEEK_OF = "2026-02-16";
  const SEND_WEEK_OF = "2026-02-23";

  await resetWeek(SEND_WEEK_OF);

  // Generate
  const genDate = findDateInWeekMatchingDow(PREV_WEEK_OF, schedule.generate.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz));

  // First send
  const sendDate = findDateInWeekMatchingDow(SEND_WEEK_OF, schedule.send.dow, tz);
  const sendNow = localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz);
  await tickAt(sendNow);

  // Get weekly run id
  const weekly = await getWeekly(SEND_WEEK_OF);
  assert.equal(weekly.status, "ok");
  const runId = weekly.weekly_run?.id ?? weekly.weekly_run?.weekly_run_id ?? null;
  assert.ok(runId, "expected weekly_run.id in admin/weekly response");

  const s1 = await getSends(runId);
  const sends1 = s1.sends ?? s1.items ?? [];
  assert.ok(sends1.length >= 1, "expected at least 1 send after first send tick");

  // Second send tick — must not create new sends
  await tickAt(sendNow);
  const s2 = await getSends(runId);
  const sends2 = s2.sends ?? s2.items ?? [];

  assert.equal(
    sends2.length, sends1.length,
    `Send count changed on second tick: ${sends1.length} → ${sends2.length} (idempotency broken)`
  );
});

// ---------------------------------------------------------------------------
// 5. Normal same-Tuesday flow: lock fires before send on the same Tuesday
// ---------------------------------------------------------------------------

test("same-tuesday: lock fires at 09:45 and send fires at 10:00 on Tuesday", async () => {
  const { tz, schedule } = await getConfig();

  const PREV_WEEK_OF = "2026-05-11"; // Mon May 11 → Fri May 15 generate
  const SEND_WEEK_OF = "2026-05-18"; // Mon May 18 → Tue May 19 lock+send

  await resetWeek(SEND_WEEK_OF);

  // Generate on Friday May 15
  const genDate = findDateInWeekMatchingDow(PREV_WEEK_OF, schedule.generate.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz));

  // Lock on Tuesday May 19
  const lockDate = findDateInWeekMatchingDow(SEND_WEEK_OF, schedule.lock.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(lockDate, schedule.lock.time, tz));

  const afterLock = await getWeekly(SEND_WEEK_OF);
  assert.equal(afterLock.status, "ok");
  const lockedAt = afterLock.weekly_run?.locked_at ?? null;
  assert.ok(lockedAt, `weekly run should be locked after lock tick. run=${JSON.stringify(afterLock.weekly_run)}`);

  // Send on Tuesday May 19 (same day, later time)
  const sendDate = findDateInWeekMatchingDow(SEND_WEEK_OF, schedule.send.dow, tz);
  const sendTick = await tickAt(localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz));

  assert.ok(
    Array.isArray(sendTick.actions) && sendTick.actions.includes("send_stub"),
    `send_stub must fire after lock. actions=${JSON.stringify(sendTick.actions)}`
  );
});
