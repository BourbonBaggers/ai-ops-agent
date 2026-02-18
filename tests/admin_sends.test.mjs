// tests/admin_sends.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { getJson, postJson, qs } from "./_helpers.mjs";

const WEEK_OF = process.env.WEEK_OF || "2026-02-16";

test("dev/run reset+force produces sent_stub with 3 candidates and exactly 1 send", async () => {
  const run = await postJson(`/dev/run${qs({ week_of: WEEK_OF, reset: 1, force: 1 })}`);

  assert.equal(run.status, "ok");
  assert.equal(run.week_of, WEEK_OF);
  assert.equal(run.weekly_run.status, "sent_stub");
  assert.ok(run.weekly_run.id);
  assert.ok(run.weekly_run.sent_at);

  const candidates = await getJson(`/admin/candidates${qs({ week_of: WEEK_OF })}`);
  assert.equal(candidates.status, "ok");
  assert.equal(candidates.count, 3);
  assert.ok(candidates.selected_candidate_id);

  await sleep(25);

  const sends = await getJson(`/admin/sends${qs({ weekly_run_id: run.weekly_run.id })}`);
  assert.equal(sends.status, "ok");
  assert.equal(sends.weekly_run_id, run.weekly_run.id);
  assert.equal(sends.sends.length, 1);
  assert.equal(sends.sends[0].candidate_id, candidates.selected_candidate_id);
});

test("dev/run without reset does NOT create a duplicate send", async () => {
  const weekly = await getJson(`/admin/weekly${qs({ week_of: WEEK_OF })}`);
  const runId = weekly.weekly_run.id;

  const before = await getJson(`/admin/sends${qs({ weekly_run_id: runId })}`);
  assert.equal(before.sends.length, 1);

  const again = await postJson(`/dev/run${qs({ week_of: WEEK_OF, force: 1 })}`);
  assert.equal(again.status, "ok");

  const after = await getJson(`/admin/sends${qs({ weekly_run_id: runId })}`);
  assert.equal(after.sends.length, 1);
});