import { json, normalizePath, nowIso, nowInTzISO, getWeekOf, getPartsInTz } from "../lib/utils.js";
import { loadSettings } from "../lib/settings.js";
import { generateCandidatesForWeek } from "./candidates.js";

// GET /jobs/tick
export async function handleJobs(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/jobs/tick" && (method === "GET" || method === "POST")) {
    return tick(env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function tick(env) {
  const settings = loadSettings(env);
  const tz = settings.timezone;

  const now = new Date();
  const nowZ = nowInTzISO(tz);
  const week_of = getWeekOf(tz);
  const { dow, hhmm } = getPartsInTz(now, tz);
  const schedule = settings.schedule;

  // ensure weekly run exists
  const run = await ensureWeeklyRun(env, week_of);

  const actions = [];

  // 1) Generate stage
  if (dow === schedule.generate.dow && hhmm === schedule.generate.time) {
    const res = await generateCandidatesForWeek(env, week_of, { force: false });
    if (!res.skipped) actions.push("generate");
  }

  // Refresh run after possible generate
  const run2 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  // 2) Lock stage
  if (dow === schedule.lock.dow && hhmm === schedule.lock.time) {
    const didLock = await lockWeeklyRun(env, run2, nowZ);
    if (didLock) actions.push("lock");
  }

  // Refresh run after possible lock
  const run3 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  // 3) Send stage (STUB)
  if (dow === schedule.send.dow && hhmm === schedule.send.time) {
    const didSend = await sendStub(env, run3, nowZ);
    if (didSend) actions.push("send_stub");
  }

  return json({
    status: "ok",
    now: now.toISOString(),
    week_of,
    actions,
    config: {
      timezone: tz,
      generate: schedule.generate,
      lock: schedule.lock,
      send: schedule.send
    }
  });
}


export async function ensureWeeklyRun(env, week_of) {
  let run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  if (run) return run;

  const id = crypto.randomUUID();
  const now = nowIso();

  await env.DB.prepare(`
    INSERT INTO weekly_runs (id, week_of, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(id, week_of, now, now).run();

  run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  return run;
}

export async function lockWeeklyRun(env, run, nowZ) {
  // If already locked, do nothing
  if (run.locked_at) return false;

  // If not selected, auto-select rank 1
  let selectedId = run.selected_candidate_id;

  if (!selectedId) {
    const first = await env.DB.prepare(`
      SELECT id FROM candidates
      WHERE weekly_run_id = ? AND rank = 1
      LIMIT 1
    `).bind(run.id).first();

    if (first?.id) selectedId = first.id;
  }

  await env.DB.prepare(`
    UPDATE weekly_runs
    SET selected_candidate_id = ?, locked_at = ?, status = 'locked', updated_at = ?
    WHERE id = ?
  `).bind(selectedId ?? null, nowZ, nowZ, run.id).run();

  return true;
}

export async function sendStub(env, run, nowZ) {
  // If we've already created a send row for this weekly_run, don't do it again.
  const existing = await env.DB.prepare(`
    SELECT id FROM sends
    WHERE weekly_run_id = ?
    LIMIT 1
  `).bind(run.id).first();

  if (existing?.id) {
    // Also backfill weekly_runs in case earlier code inserted sends but never updated the run.
    if (!run.sent_at) {
      await env.DB.prepare(`
        UPDATE weekly_runs
        SET sent_at = ?, status = 'sent_stub', updated_at = ?
        WHERE id = ?
      `).bind(nowZ, nowZ, run.id).run();
    }
    return false;
  }

  // If not locked yet, lock it right now (enforces “auto-authorized”)
  if (!run.locked_at) {
    await lockWeeklyRun(env, run, nowZ);
    run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE id = ?`).bind(run.id).first();
  }

  // Ensure we have a selected candidate (lock should have done this, but belt+suspenders)
  if (!run.selected_candidate_id) {
    const first = await env.DB.prepare(`
      SELECT id FROM candidates
      WHERE weekly_run_id = ? AND rank = 1
      LIMIT 1
    `).bind(run.id).first();

    if (first?.id) {
      await env.DB.prepare(`
        UPDATE weekly_runs
        SET selected_candidate_id = ?, updated_at = ?
        WHERE id = ?
      `).bind(first.id, nowZ, run.id).run();

      run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE id = ?`).bind(run.id).first();
    }
  }

  const cand = run.selected_candidate_id
    ? await env.DB.prepare(`SELECT * FROM candidates WHERE id = ?`).bind(run.selected_candidate_id).first()
    : null;

  if (!cand) throw new Error("No selected candidate found to create send record");

  const senderMailbox = env.SENDER_MAILBOX;
  const replyTo = env.REPLY_TO;
  if (!senderMailbox || !replyTo) throw new Error("Missing required mail environment variables.");

  const sendId = crypto.randomUUID();
  const trackingSalt = crypto.randomUUID();

  const bodyHtml = `<pre style="white-space:pre-wrap;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(
    cand.body_markdown || ""
  )}</pre>`;
  const bodyText = (cand.body_markdown || "").replace(/\r\n/g, "\n");

  await env.DB.prepare(`
    INSERT INTO sends (
      id, weekly_run_id, candidate_id,
      subject, preview_text,
      body_html, body_text,
      sender_mailbox, reply_to,
      tracking_salt,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sendId,
    run.id,
    cand.id,
    cand.subject,
    cand.preview_text,
    bodyHtml,
    bodyText,
    senderMailbox,
    replyTo,
    trackingSalt,
    nowZ
  ).run();

  // Mark the run as "sent_stub"
  await env.DB.prepare(`
    UPDATE weekly_runs
    SET sent_at = ?, status = 'sent_stub', updated_at = ?
    WHERE id = ?
  `).bind(nowZ, nowZ, run.id).run();

  return true;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getTableColumns(env, tableName) {
  const res = await env.DB.prepare(`PRAGMA table_info(${tableName});`).all();
  // rows contain: cid, name, type, notnull, dflt_value, pk
  return new Set(res.results.map(r => r.name));
}

async function insertRowFlexible(env, tableName, dataObj) {
  const cols = await getTableColumns(env, tableName);

  const keys = Object.keys(dataObj).filter(k => cols.has(k));
  if (keys.length === 0) {
    throw new Error(`No matching columns to insert into ${tableName}`);
  }

  const placeholders = keys.map(() => "?").join(", ");
  const sql = `INSERT INTO ${tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
  const values = keys.map(k => dataObj[k]);

  await env.DB.prepare(sql).bind(...values).run();
}