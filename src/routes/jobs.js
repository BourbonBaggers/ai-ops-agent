import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf, getPartsInTz } from "../lib/time.js";
import { loadSettings } from "../lib/settings.js";
import { generateCandidatesForWeek } from "./candidates.js";


export async function handleJobs(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/jobs") {
    return json({
      status: "ok",
      endpoints: [
        "POST /jobs/tick",
      ],
    });
  }

  if (pathname === "/jobs/tick" && request.method === "POST") {
    return tick(request, env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function tick(request, env) {
  const settings = loadSettings(env);
  const tz = settings.timezone;
  const schedule = settings.schedule;

  const now = getNowForTick(request, env);     // <-- key point
  const nowUtc = now.toISOString();
  const nowLocal = nowInTzISO(tz, now);

  const week_of = getWeekOf(tz, now);
  const { dow, hhmm } = getPartsInTz(now, tz);

  const actions = [];

  await ensureWeeklyRun(env, week_of);

  if (dow === schedule.generate.dow && hhmm === schedule.generate.time) {
    const res = await generateCandidatesForWeek(env, week_of, { force: false });
    if (!res.skipped) actions.push("generate");
  }

  const run2 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  if (dow === schedule.lock.dow && hhmm === schedule.lock.time) {
    const didLock = await lockWeeklyRun(env, run2, nowUtc);
    if (didLock) actions.push("lock");
  }

  const run3 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  if (dow === schedule.send.dow && hhmm === schedule.send.time) {
    const didSend = await sendStub(env, run3, nowUtc);
    if (didSend) actions.push("send_stub");
  }

  return json({
    status: "ok",
    now_utc: nowUtc,
    now_local: nowLocal,
    tz,
    week_of,
    actions,
    config: {
      timezone: tz,
      generate: schedule.generate,
      lock: schedule.lock,
      send: schedule.send,
    },
  });
}

// dev-only time override for deterministic tests
function getNowForTick(request, env) {
  const url = new URL(request.url);

  // Only allow override in dev
  if (env.ENVIRONMENT !== "dev") return new Date();

  const nowQ = url.searchParams.get("now");
  if (!nowQ) return new Date();

  // Accept either ISO or "YYYY-MM-DDTHH:mm:ss" (treated as local-ish; still becomes a Date)
  const d = new Date(nowQ);
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid now override; expected ISO date-time");
  }
  return d;
}

export async function ensureWeeklyRun(env, week_of) {
  let run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  if (run) return run;

  const id = crypto.randomUUID();
  const now = nowUtcIso();

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
  // (This is conservative. With your new uniqueness constraint, this is still fine.)
  const existing = await env.DB.prepare(`
    SELECT id FROM sends
    WHERE weekly_run_id = ?
    LIMIT 1
  `).bind(run.id).first();

  if (existing?.id) {
    // Backfill weekly_runs in case earlier code inserted sends but never updated the run.
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

  if (!cand) return false; // no candidates generated yet — skip silently

  const isDev = (env.ENVIRONMENT || "").toLowerCase() === "dev";

  // Support both legacy + current names
  const senderMailbox =
    env.MAIL_SENDER_UPN ||
    env.SENDER_MAILBOX ||
    (isDev ? "stub-sender@example.com" : null);

  const replyTo =
    env.REPLY_TO ||
    (isDev ? "stub-replyto@example.com" : null);

  if (!senderMailbox || !replyTo) {
    throw new Error(
      "Missing required mail environment variables. Expected MAIL_SENDER_UPN (or SENDER_MAILBOX) and REPLY_TO."
    );
  }

  const sendId = crypto.randomUUID();
  const trackingSalt = crypto.randomUUID();

  const bodyHtml = `<pre style="white-space:pre-wrap;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(
    cand.body_markdown || ""
  )}</pre>`;
  const bodyText = (cand.body_markdown || "").replace(/\r\n/g, "\n");

  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO sends (
      id, weekly_run_id, candidate_id,
      subject, preview_text, body_html, body_text,
      sender_mailbox, reply_to, tracking_salt, created_at
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

  const didInsert = (insert?.meta?.changes ?? 0) > 0;
  if (!didInsert) return false;

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

