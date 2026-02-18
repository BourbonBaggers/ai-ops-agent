import { json, normalizePath, nowInTzISO, getWeekOf } from "../lib/utils.js";
import { loadSettings } from "../lib/settings.js";

import { ensureWeeklyRun, lockWeeklyRun, sendStub } from "./jobs.js";
import { generateCandidatesForWeek } from "./candidates.js";

export async function handleDev(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (!path.startsWith("/dev/")) return null;

  const settings = loadSettings(env);
  const tz = settings.timezone;

  // GET /dev/ping
  if (path === "/dev/ping" && method === "GET") {
    const nowZ = nowInTzISO(tz);
    const week_of = getWeekOf(tz);
    return json({ status: "ok", now: nowZ, tz, week_of });
  }

  // POST /dev/run?week_of=YYYY-MM-DD&force=1
  if (path === "/dev/run" && method === "POST") {
    const nowZ = nowInTzISO(tz);

    // week_of can come from querystring, JSON body, or default to current week
    let body = {};
    try {
      body = await request.json();
    } catch (_) {}

    const week_of =
      url.searchParams.get("week_of") ||
      body.week_of ||
      getWeekOf(tz);

    // force regen can come from querystring or body
    const force =
      url.searchParams.get("force") === "1" ||
      body.force === true;

    // --- /dev/run pipeline (refresh weekly_run after each stage) ---

    // Ensure weekly run exists
    let run = await ensureWeeklyRun(env, week_of);
const reset = url.searchParams.get("reset") === "1";

// If already sent, do NOT mutate unless reset=1
if (run.status === "sent_stub" && !reset) {
  const sendsCountRow = await env.DB
    .prepare(`SELECT COUNT(*) AS c FROM sends WHERE weekly_run_id = ?`)
    .bind(run.id)
    .first();

  return json({
    status: "ok",
    week_of,
    force,
    reset,
    note: "Run already sent_stub; skipping generate/lock/send. Use reset=1 to rebuild.",
    actions: { generated: false, locked: false, sent_stub: false },
    weekly_run: {
      id: run.id,
      status: run.status,
      generated_at: run.generated_at,
      locked_at: run.locked_at,
      sent_at: run.sent_at,
      selected_candidate_id: run.selected_candidate_id,
    },
    sends_for_run: sendsCountRow?.c ?? 0,
  });
}

// reset=1: wipe dependent rows + reset run fields
if (reset) {
  await env.DB.prepare(`DELETE FROM sends WHERE weekly_run_id = ?`).bind(run.id).run();
  await env.DB.prepare(`DELETE FROM candidates WHERE weekly_run_id = ?`).bind(run.id).run();

  const nowZ = nowInTzISO(loadSettings(env).timezone);

  await env.DB.prepare(`
    UPDATE weekly_runs
    SET generated_at = NULL,
        locked_at = NULL,
        sent_at = NULL,
        status = 'pending',
        selected_candidate_id = NULL,
        updated_at = ?
    WHERE id = ?
  `).bind(nowZ, run.id).run();

  run = await env.DB
    .prepare(`SELECT * FROM weekly_runs WHERE id = ?`)
    .bind(run.id)
    .first();
}
    // 1) Generate candidates (optionally force)
    const generated = await generateCandidatesForWeek(env, week_of, { force });

    // refresh run from DB
    run = await env.DB
      .prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
      .bind(week_of)
      .first();

    // 2) Lock
    const locked = await lockWeeklyRun(env, run, nowZ);

    // refresh again
    run = await env.DB
      .prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
      .bind(week_of)
      .first();

    // 3) Send stub
    const sent_stub = await sendStub(env, run, nowZ);

    await sendStub(env, run, nowZ);

    // re-fetch to get updated sent_at/status
    run = await env.DB
    .prepare(`SELECT * FROM weekly_runs WHERE id = ?`)
    .bind(run.id)
    .first();


    const sendsCountRow = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM sends WHERE weekly_run_id = ?`)
      .bind(run.id)
      .first();

    return json({
      status: "ok",
      week_of,
      force,
      actions: { generated, locked, sent_stub },
      weekly_run: {
        id: run.id,
        status: run.status,
        generated_at: run.generated_at,
        locked_at: run.locked_at,
        sent_at: run.sent_at,
        selected_candidate_id: run.selected_candidate_id,
      },
      sends_for_run: sendsCountRow?.c ?? 0,
    });
  }

  // Unknown /dev route
  return json({ status: "error", error: "Not found" }, 404);
}