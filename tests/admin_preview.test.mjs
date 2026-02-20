// tests/admin_preview.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  getJson,
  postJson,
  findDateInWeekMatchingDow,
  localYmdHhmmToUtcIso,
} from "./_helpers.mjs";

// Weeks reserved for specific state scenarios — each is unique to this test file.
const SENT_WEEK     = "2026-02-16"; // also used by idempotency tests; reset before use
const UNLOCKED_WEEK = "2026-07-06"; // Monday — tick generate only, never lock/send
const LOCKED_WEEK   = "2026-07-13"; // Monday — tick generate + lock, never send
const NO_CAND_WEEK  = "2026-06-08"; // Monday — off-schedule tick only, 0 candidates
const NO_RUN_WEEK   = "2026-09-07"; // Monday — never ticked, no run row

async function tickAt(isoUtc) {
  const r = await postJson(`/jobs/tick?now=${encodeURIComponent(isoUtc)}`);
  assert.equal(r.status, "ok", `tick should return ok (got: ${JSON.stringify(r)})`);
  return r;
}

async function resetWeek(week_of) {
  const r = await postJson(`/dev/run?week_of=${encodeURIComponent(week_of)}&reset=1`);
  assert.equal(r.status, "ok", "dev/run reset should return ok");
  return r;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("admin/preview: missing week_of returns 400", async () => {
  const r = await getJson("/admin/preview", 400);
  assert.equal(r.status, "error");
});

test("admin/preview: invalid week_of format returns 400", async () => {
  const r = await getJson("/admin/preview?week_of=not-a-date", 400);
  assert.equal(r.status, "error");
});

test("admin/preview: POST returns 405", async () => {
  const r = await postJson(`/admin/preview?week_of=${NO_RUN_WEEK}`, {}, 405);
  assert.equal(r.status, "error");
});

// ---------------------------------------------------------------------------
// State: no weekly run
// ---------------------------------------------------------------------------

test("admin/preview: week with no run returns preview=null with reason", async () => {
  const r = await getJson(`/admin/preview?week_of=${NO_RUN_WEEK}`);
  assert.equal(r.status, "ok");
  assert.equal(r.preview, null);
  assert.match(r.reason, /no weekly run/i);
});

// ---------------------------------------------------------------------------
// State: run exists, no candidates
// ---------------------------------------------------------------------------

test("admin/preview: run with no candidates returns preview=null with reason", async () => {
  const cfg = await getJson("/admin/config");
  const tz = cfg.tz ?? cfg.config?.timezone;
  // 2026-06-10 is the Wednesday of NO_CAND_WEEK — off-schedule, never generates.
  const offNow = localYmdHhmmToUtcIso("2026-06-10", "12:34", tz);
  await tickAt(offNow);

  const r = await getJson(`/admin/preview?week_of=${NO_CAND_WEEK}`);
  assert.equal(r.status, "ok");
  assert.equal(r.preview, null);
  assert.match(r.reason, /no candidates/i);
});

// ---------------------------------------------------------------------------
// State: candidates generated, not yet locked
// ---------------------------------------------------------------------------

test("admin/preview: unlocked week shows candidates with auto-lock indicator", async () => {
  const cfg = await getJson("/admin/config");
  const tz = cfg.tz ?? cfg.config?.timezone;
  const schedule = cfg.schedule ?? cfg.config?.schedule;

  // Tick at generate time only — no lock or send fires.
  const genDate = findDateInWeekMatchingDow(UNLOCKED_WEEK, schedule.generate.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz));

  const r = await getJson(`/admin/preview?week_of=${UNLOCKED_WEEK}`);
  assert.equal(r.status, "ok");
  assert.equal(r.state, "unlocked");
  assert.equal(r.preview, null);
  assert.ok(r.reason, "reason should be present");
  assert.ok(r.auto_lock_candidate_id, "auto_lock_candidate_id should be present");

  const candidates = r.candidates ?? [];
  assert.ok(candidates.length > 0, "candidates array should be non-empty");

  // Exactly one candidate is flagged will_auto_lock, and it is rank 1.
  const autoLocked = candidates.filter(c => c.will_auto_lock);
  assert.equal(autoLocked.length, 1, "exactly one candidate should have will_auto_lock");
  assert.equal(autoLocked[0].rank, 1, "the auto-lock candidate must be rank 1");
  assert.equal(autoLocked[0].id, r.auto_lock_candidate_id, "id must match auto_lock_candidate_id");

  // Every candidate exposes the expected fields.
  for (const c of candidates) {
    assert.ok(c.id, "candidate.id missing");
    assert.ok(c.subject, "candidate.subject missing");
    assert.ok(c.body_markdown !== undefined, "candidate.body_markdown missing");
  }
});

// ---------------------------------------------------------------------------
// State: locked, no sends row yet
// ---------------------------------------------------------------------------

test("admin/preview: locked week constructs preview from selected candidate (no DB write)", async () => {
  const cfg = await getJson("/admin/config");
  const tz = cfg.tz ?? cfg.config?.timezone;
  const schedule = cfg.schedule ?? cfg.config?.schedule;

  // Generate candidates.
  const genDate = findDateInWeekMatchingDow(LOCKED_WEEK, schedule.generate.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(genDate, schedule.generate.time, tz));

  // Lock the run (but stop short of send time).
  const lockDate = findDateInWeekMatchingDow(LOCKED_WEEK, schedule.lock.dow, tz);
  await tickAt(localYmdHhmmToUtcIso(lockDate, schedule.lock.time, tz));

  const r = await getJson(`/admin/preview?week_of=${LOCKED_WEEK}`);
  assert.equal(r.status, "ok");
  assert.equal(r.state, "locked");

  const p = r.preview;
  assert.ok(p, "preview should be present");

  // Fields that come from the candidate / env (all must be present).
  assert.ok(p.weekly_run_id, "preview.weekly_run_id missing");
  assert.ok(p.candidate_id, "preview.candidate_id missing");
  assert.ok(p.subject, "preview.subject missing");
  assert.ok(p.body_html, "preview.body_html missing");
  assert.ok(p.body_text !== undefined, "preview.body_text missing");
  assert.ok(p.sender_mailbox, "preview.sender_mailbox missing");
  assert.ok(p.reply_to, "preview.reply_to missing");

  // WYSIWYG: body_html must be wrapped exactly as sendStub wraps it.
  assert.match(p.body_html, /<pre\s/);

  // No sends-row-specific fields should exist (no DB write occurred).
  assert.equal(p.id, undefined, "preview.id must not exist — no send row was created");
  assert.equal(p.tracking_salt, undefined, "preview.tracking_salt must not exist — no send row was created");

  // Confirm no sends were created for this week as a side effect.
  const weekly = await getJson(`/admin/weekly?week_of=${LOCKED_WEEK}`);
  const runId = weekly.weekly_run?.id;
  assert.ok(runId, "weekly_run.id should exist");
  const sendsRow = await getJson(`/admin/sends?weekly_run_id=${runId}`);
  assert.equal((sendsRow.sends ?? []).length, 0, "preview must not create a sends row");
});

// ---------------------------------------------------------------------------
// State: already sent — reads directly from sends table
// ---------------------------------------------------------------------------

test("admin/preview: sent week returns the sends-table record verbatim", async () => {
  // Reset to a clean sent_stub state.
  await resetWeek(SENT_WEEK);

  const r = await getJson(`/admin/preview?week_of=${SENT_WEEK}`);
  assert.equal(r.status, "ok");
  assert.equal(r.state, "sent");

  const p = r.preview;
  assert.ok(p, "preview should be present");

  // Every column from the sends table must appear.
  assert.ok(p.id, "preview.id missing");
  assert.ok(p.weekly_run_id, "preview.weekly_run_id missing");
  assert.ok(p.candidate_id, "preview.candidate_id missing");
  assert.ok(p.subject, "preview.subject missing");
  assert.ok(p.preview_text, "preview.preview_text missing");
  assert.ok(p.body_html, "preview.body_html missing");
  assert.ok(p.body_text !== undefined, "preview.body_text missing");
  assert.ok(p.sender_mailbox, "preview.sender_mailbox missing");
  assert.ok(p.reply_to, "preview.reply_to missing");
  assert.ok(p.tracking_salt, "preview.tracking_salt missing");
  assert.ok(p.created_at, "preview.created_at missing");

  // WYSIWYG: body_html from the sends row is the pre-wrapped HTML.
  assert.match(p.body_html, /<pre\s/);
});
