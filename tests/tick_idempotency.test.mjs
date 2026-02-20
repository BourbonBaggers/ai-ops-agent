// tests/tick_idempotency.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  getJson,
  postJson,
  findDateInWeekMatchingDow,
  localYmdHhmmToUtcIso,
} from "./_helpers.mjs";

const WEEK_OF = "2026-02-16"; // Monday

async function tickAt(isoUtc) {
  const r = await postJson(`/jobs/tick?now=${encodeURIComponent(isoUtc)}`);
  assert.equal(r.status, "ok", "tick should return status=ok");
  return r;
}

async function resetWeek(week_of) {
  // reset DB state for this week without forcing all stages
  // (your dev/run supports reset=1; force is optional)
  const r = await postJson(`/dev/run?week_of=${encodeURIComponent(week_of)}&reset=1`);
  assert.equal(r.status, "ok", "dev/run reset should return status=ok");
  return r;
}

async function getCandidates(week_of) {
  return await getJson(`/admin/candidates?week_of=${encodeURIComponent(week_of)}`);
}

async function getWeekly(week_of) {
  return await getJson(`/admin/weekly?week_of=${encodeURIComponent(week_of)}`);
}

async function getSendsByWeeklyRunId(weekly_run_id) {
  return await getJson(`/admin/sends?weekly_run_id=${encodeURIComponent(weekly_run_id)}`);
}

async function getWeeklyRunIdForWeek(week_of) {
  const w = await getWeekly(week_of);
  assert.equal(w.status, "ok");
  const id =
    w.weekly_run?.id ??
    w.weekly_run?.weekly_run_id ??
    w.weeklyRun?.id ??
    null;

  assert.ok(id, "admin/weekly response did not include weekly_run.id");
  return id;
}

// --- tests ---

test("tick idempotency: generate stage does not duplicate candidates", async () => {
  const cfg = await getJson("/admin/config");
  assert.equal(cfg.status, "ok");

  const tz = cfg.tz ?? cfg.config?.timezone ?? cfg.config?.tz;
  const schedule = cfg.schedule ?? cfg.config?.schedule;
  assert.ok(tz, "config missing tz");
  assert.ok(schedule?.generate?.dow, "config missing schedule.generate.dow");
  assert.ok(schedule?.generate?.time, "config missing schedule.generate.time");

  await resetWeek(WEEK_OF);

  const genDate = findDateInWeekMatchingDow(WEEK_OF, schedule.generate.dow, tz);
  const now1 = localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz);

  const before = await getCandidates(WEEK_OF);
  assert.equal(before.status, "ok");
  const n0 = (before.candidates ?? before.items ?? []).length;

  const t1 = await tickAt(now1);
  const mid = await getCandidates(WEEK_OF);
  const n1 = (mid.candidates ?? mid.items ?? []).length;

  const t2 = await tickAt(now1);
  const after = await getCandidates(WEEK_OF);
  const n2 = (after.candidates ?? after.items ?? []).length;

  // first tick may generate (n1 >= n0), but second tick must not increase again
  assert.equal(n2, n1, `candidates duplicated on second generate tick: n1=${n1}, n2=${n2}`);

  // IDs must be stable — same count with different IDs means silent delete+recreate
  const ids1 = (mid.candidates ?? mid.items ?? []).map(c => c.id).sort();
  const ids2 = (after.candidates ?? after.items ?? []).map(c => c.id).sort();
  assert.deepEqual(ids2, ids1, "candidate IDs changed on second tick — silent delete+recreate detected");

  // sanity: second tick shouldn't claim "generate" action again (if you keep actions)
  if (Array.isArray(t2.actions)) {
    assert.ok(!t2.actions.includes("generate"), "second generate tick should not repeat generate action");
  }
});

test("tick idempotency: lock stage does not re-lock or mutate timestamps", async () => {
  const cfg = await getJson("/admin/config");
  assert.equal(cfg.status, "ok");

  const tz = cfg.tz ?? cfg.config?.timezone ?? cfg.config?.tz;
  const schedule = cfg.schedule ?? cfg.config?.schedule;
  assert.ok(tz, "config missing tz");
  assert.ok(schedule?.lock?.dow, "config missing schedule.lock.dow");
  assert.ok(schedule?.lock?.time, "config missing schedule.lock.time");

  await resetWeek(WEEK_OF);

  // Ensure candidates exist so lock has something to lock, by running generate once at schedule time.
  const genDate = findDateInWeekMatchingDow(WEEK_OF, schedule.generate.dow, tz);
  const genNow = localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz);
  await tickAt(genNow);

  const lockDate = findDateInWeekMatchingDow(WEEK_OF, schedule.lock.dow, tz);
  const lockNow = localYmdHhmmToUtcIso(lockDate, schedule.lock.time, tz);

  await tickAt(lockNow);
  const w1 = await getWeekly(WEEK_OF);
  assert.equal(w1.status, "ok");
  const lockedAt1 = w1.weekly_run?.locked_at ?? w1.weekly_run?.lockedAt ?? null;
  assert.ok(lockedAt1, "expected locked_at to be set after first lock tick");

  await tickAt(lockNow);
  const w2 = await getWeekly(WEEK_OF);
  const lockedAt2 = w2.weekly_run?.locked_at ?? w2.weekly_run?.lockedAt ?? null;

  assert.equal(lockedAt2, lockedAt1, "locked_at changed on second lock tick (should be idempotent)");
});

test("tick idempotency: send_stub stage does not duplicate sends", async () => {
  const cfg = await getJson("/admin/config");
  assert.equal(cfg.status, "ok");

  const tz = cfg.tz ?? cfg.config?.timezone ?? cfg.config?.tz;
  const schedule = cfg.schedule ?? cfg.config?.schedule;
  assert.ok(tz, "config missing tz");
  assert.ok(schedule?.send?.dow, "config missing schedule.send.dow");
  assert.ok(schedule?.send?.time, "config missing schedule.send.time");

  await resetWeek(WEEK_OF);

  // Run generate + lock once so send has a locked run to operate on.
  const genDate = findDateInWeekMatchingDow(WEEK_OF, schedule.generate.dow, tz);
  const genNow = localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz);
  await tickAt(genNow);

  const lockDate = findDateInWeekMatchingDow(WEEK_OF, schedule.lock.dow, tz);
  const lockNow = localYmdHhmmToUtcIso(lockDate, schedule.lock.time, tz);
  await tickAt(lockNow);

  const sendDate = findDateInWeekMatchingDow(WEEK_OF, schedule.send.dow, tz);
  const sendNow = localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz);

  await tickAt(sendNow);
  const weeklyRunId = await getWeeklyRunIdForWeek(WEEK_OF);

  await tickAt(sendNow);
  const s1 = await getSendsByWeeklyRunId(weeklyRunId);
  assert.equal(s1.status, "ok");
  const sends1 = s1.sends ?? s1.items ?? [];
  assert.ok(sends1.length >= 1, "expected at least 1 send after first send tick");
  const n1 = sends1.length;

  await tickAt(sendNow);
  const s2 = await getSendsByWeeklyRunId(weeklyRunId);
  const sends2 = s2.sends ?? s2.items ?? [];
  const n2 = sends2.length;

  assert.equal(n2, n1, `send duplicated on second send tick: n1=${n1}, n2=${n2}`);
});

test("tick state machine: send tick with no candidates skips silently (no 500)", async () => {
  // Use a far-future week that no other test touches.
  // "2026-06-01" is a Monday; "2026-06-03" (Wednesday) is safe to use as an off-schedule time.
  const EMPTY_WEEK = "2026-06-01";
  const OFF_SCHEDULE_DAY = "2026-06-03"; // Wednesday — never matches generate/lock/send defaults

  const cfg = await getJson("/admin/config");
  assert.equal(cfg.status, "ok");

  const tz = cfg.tz ?? cfg.config?.timezone ?? cfg.config?.tz;
  const schedule = cfg.schedule ?? cfg.config?.schedule;
  assert.ok(tz, "config missing tz");
  assert.ok(schedule?.send?.dow, "config missing schedule.send.dow");
  assert.ok(schedule?.send?.time, "config missing schedule.send.time");

  // Tick at an off-schedule time (Wednesday noon) to create the weekly run WITHOUT
  // triggering generate, lock, or send. This leaves a pending run with 0 candidates.
  // Safe to re-run: ensureWeeklyRun is idempotent; no candidates accumulate.
  const offNow = localYmdHhmmToUtcIso(OFF_SCHEDULE_DAY, "12:34", tz);
  await tickAt(offNow);

  // Verify 0 candidates exist for this week (the off-schedule tick must not generate).
  const candidates = await getCandidates(EMPTY_WEEK);
  assert.equal(candidates.status, "ok");
  const nCandidates = (candidates.candidates ?? candidates.items ?? []).length;
  assert.equal(nCandidates, 0, "off-schedule tick must not generate candidates");

  // Tick at send time with no candidates — must return ok, not a 500.
  const sendDate = findDateInWeekMatchingDow(EMPTY_WEEK, schedule.send.dow, tz);
  const sendNow = localYmdHhmmToUtcIso(sendDate, schedule.send.time, tz);
  const result = await tickAt(sendNow);
  assert.equal(result.status, "ok", "tick should return ok even with no candidates");

  // send_stub must NOT appear in actions (it should have skipped silently).
  if (Array.isArray(result.actions)) {
    assert.ok(
      !result.actions.includes("send_stub"),
      `send_stub should not fire when there are no candidates (actions=${JSON.stringify(result.actions)})`
    );
  }

  // No sends should have been created for this week.
  const weeklyRunId = await getWeeklyRunIdForWeek(EMPTY_WEEK);
  const s = await getSendsByWeeklyRunId(weeklyRunId);
  assert.equal(s.status, "ok");
  const sends = s.sends ?? s.items ?? [];
  assert.equal(sends.length, 0, "no sends should exist for a week with no candidates");
});