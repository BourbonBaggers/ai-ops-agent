import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf,  } from "../lib/time.js";
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
    const now_local = nowInTzISO(tz);
    const week_of = getWeekOf(tz);
    return json({ status: "ok", now: now_local, tz, week_of });
  }

  // POST /dev/run?week_of=YYYY-MM-DD&force=1&reset=1
  if (path === "/dev/run" && method === "POST") {
    const now_utc = nowUtcIso();      // single source of truth for DB timestamps
    const now_local = nowInTzISO(tz); // for response/debugging only

    // week_of can come from querystring, JSON body, or default to current week
    let body = {};
    try {
      body = await request.json();
    } catch (_) {
      // no body is fine
    }

    const week_of =
      url.searchParams.get("week_of") ||
      body.week_of ||
      getWeekOf(tz);

    const force =
      url.searchParams.get("force") === "1" ||
      body.force === true;

    const reset =
      url.searchParams.get("reset") === "1" ||
      body.reset === true;

    // Ensure weekly run exists
    let run = await ensureWeeklyRun(env, week_of);

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

      await env.DB.prepare(`
        UPDATE weekly_runs
        SET generated_at = NULL,
            locked_at = NULL,
            sent_at = NULL,
            status = 'pending',
            selected_candidate_id = NULL,
            updated_at = ?
        WHERE id = ?
      `).bind(now_utc, run.id).run();

      run = await env.DB
        .prepare(`SELECT * FROM weekly_runs WHERE id = ?`)
        .bind(run.id)
        .first();
    }

    // 1) Generate candidates (optionally force)
    const generated = await generateCandidatesForWeek(env, week_of, { force });

    // refresh run by id (stop playing games with week_of)
    run = await env.DB
      .prepare(`SELECT * FROM weekly_runs WHERE id = ?`)
      .bind(run.id)
      .first();

    // 2) Lock (use UTC timestamp for DB)
    const locked = await lockWeeklyRun(env, run, now_utc);

    run = await env.DB
      .prepare(`SELECT * FROM weekly_runs WHERE id = ?`)
      .bind(run.id)
      .first();

    // 3) Send stub (use UTC timestamp for DB)
    const sent_stub = await sendStub(env, run, now_utc);

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
      reset,
      now_utc,
      now_local,
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

  return json({ status: "error", error: "Not found" }, 404);
}