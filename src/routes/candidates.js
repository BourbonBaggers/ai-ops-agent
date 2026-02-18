import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf } from "../lib/time.js";
import { MockProvider } from "../providers/mockProvider.js";

// Public exports so jobs.js can call generation without HTTP
export async function generateCandidatesForWeek(env, week_of, { force = false } = {}) {
  week_of = normalizeWeekOf(week_of);

  const run = await ensureWeeklyRun(env, week_of);
    const now = nowUtcIso();

  // Guard: do not overwrite existing candidates unless forced
  const existing = await env.DB.prepare(
    `SELECT COUNT(1) AS n FROM candidates WHERE weekly_run_id = ?`
  ).bind(run.id).first();

  if (!force && Number(existing?.n || 0) > 0) {
    return { status: "ok", week_of, weekly_run_id: run.id, generated: 0, skipped: true, reason: "already_exists" };
  }

  // Pull active policy
  const policy = await env.DB.prepare(`
    SELECT id, title, body_markdown, created_at
    FROM policy_versions
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).first();

  if (!policy) {
    return { status: "error", message: "No active policy found. Load/activate a policy first." };
  }

  // Calendar items next 90 days
  const horizon = await getCalendarHorizon(env, 90);

  // Reset candidates for this weekly_run if force OR exists
    if (force) {
    // If we already created sends for this weekly run, those rows reference candidates.
    // So delete children first (send_recipients -> sends), then candidates.
    await env.DB.prepare(`
      DELETE FROM send_recipients
      WHERE send_id IN (SELECT id FROM sends WHERE weekly_run_id = ?)
    `).bind(run.id).run();

    await env.DB.prepare(`
      DELETE FROM sends
      WHERE weekly_run_id = ?
    `).bind(run.id).run();

    await env.DB.prepare(`
      DELETE FROM candidates
      WHERE weekly_run_id = ?
    `).bind(run.id).run();

    // Optional: reset weekly run state so regen is "clean"
    await env.DB.prepare(`
      UPDATE weekly_runs
      SET generated_at = NULL,
          locked_at = NULL,
          sent_at = NULL,
          selected_candidate_id = NULL,
          status = 'pending',
          updated_at = ?
      WHERE id = ?
    `).bind(now, run.id).run();
  }
  await env.DB.prepare(`DELETE FROM candidates WHERE weekly_run_id = ?`).bind(run.id).run();

  const provider = new MockProvider();
  const generated = await provider.generateCandidates({
    policy,
    calendarItems: horizon,
    focusNotes: run.focus_notes || null,
    constraints: {
      no_emojis: true,
      no_emdash: true,
      never_discuss_pricing: true
    }
  });


  const stmts = [];

  for (let i = 0; i < generated.length; i++) {
    const c = generated[i];
    stmts.push(
      env.DB.prepare(`
        INSERT INTO candidates (
          id, weekly_run_id, rank, subject, preview_text, body_markdown, cta,
          image_refs_json, self_check_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        run.id,
        i + 1,
        c.subject,
        c.preview_text,
        c.body_markdown,
        c.cta ?? null,
        JSON.stringify(c.image_refs ?? []),
        JSON.stringify(c.self_check ?? {}),
        now
      )
    );
  }

  await env.DB.batch(stmts);

  // Mark generated_at + status
  await env.DB.prepare(`
    UPDATE weekly_runs
    SET generated_at = ?, status = 'generated', updated_at = ?
    WHERE id = ?
  `).bind(now, now, run.id).run();

  return { status: "ok", week_of, weekly_run_id: run.id, generated: generated.length, skipped: false };
}

export async function handleCandidates(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  // GET /admin/candidates?week_of=YYYY-MM-DD
  if (path === "/admin/candidates" && method === "GET") {
    const week_of = url.searchParams.get("week_of");
    if (!isDate(week_of)) return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);

    const run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
      .bind(week_of)
      .first();

    if (!run) return json({ status: "ok", week_of, count: 0, candidates: [] });

    const rows = await env.DB.prepare(`
      SELECT id, weekly_run_id, rank, subject, preview_text, body_markdown, cta,
             image_refs_json, self_check_json, created_at
      FROM candidates
      WHERE weekly_run_id = ?
      ORDER BY rank ASC
    `).bind(run.id).all();

    return json({
      status: "ok",
      week_of,
      weekly_run_id: run.id,
      selected_candidate_id: run.selected_candidate_id ?? null,
      status_value: run.status,
      count: rows.results.length,
      candidates: rows.results.map(hydrateCandidateRow)
    });
  }

  // POST /admin/candidates/generate?week_of=YYYY-MM-DD&force=1
  if (path === "/admin/candidates/generate" && method === "POST") {
    const week_of = url.searchParams.get("week_of");
    const force = url.searchParams.get("force") === "1";

    if (!isDate(week_of)) return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);

    const result = await generateCandidatesForWeek(env, week_of, { force });

    if (result.status === "error") return json(result, 400);
    return json(result);
  }

  // POST /admin/candidates/select
  // Body: { "week_of":"YYYY-MM-DD", "rank":2, "notes":"..." }
  if (path === "/admin/candidates/select" && method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ status: "error", message: "Invalid JSON body" }, 400);

    const week_of = body.week_of;
    const rank = Number(body.rank);
    const notes = typeof body.notes === "string" ? body.notes : null;

    if (!isDate(week_of)) return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);
    if (![1, 2, 3].includes(rank)) return json({ status: "error", message: "rank must be 1, 2, or 3" }, 400);

    const run = await ensureWeeklyRun(env, week_of);

    const candidate = await env.DB.prepare(`
      SELECT id, weekly_run_id, rank, subject, preview_text, body_markdown, cta, image_refs_json, self_check_json, created_at
      FROM candidates
      WHERE weekly_run_id = ? AND rank = ?
      LIMIT 1
    `).bind(run.id, rank).first();

    if (!candidate) {
      return json({ status: "error", message: "Candidate not found. Generate candidates first." }, 400);
    }

    const now = nowUtcIso();
    await env.DB.prepare(`
      UPDATE weekly_runs
      SET selected_candidate_id = ?, focus_notes = COALESCE(?, focus_notes), status = 'selected', updated_at = ?
      WHERE id = ?
    `).bind(candidate.id, notes, now, run.id).run();

    return json({
      status: "ok",
      week_of,
      weekly_run_id: run.id,
      selected_candidate_id: candidate.id,
      selected_rank: rank,
      candidate: hydrateCandidateRow(candidate)
    });
  }

  return json({ status: "error", message: "Not found" }, 404);
}

function normalizeWeekOf(input) {
  if (typeof input !== "string") throw new Error("week_of must be a string");
  const s = input.trim();

  // Accept YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  throw new Error("week_of must be YYYY-MM-DD");
}

function hydrateCandidateRow(r) {
  return {
    ...r,
    image_refs: safeJson(r.image_refs_json, []),
    self_check: safeJson(r.self_check_json, {})
  };
}

function safeJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function ensureWeeklyRun(env, week_of) {
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

async function getCalendarHorizon(env, days) {
  const start = new Date();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const from = isoDate(start);
  const to = isoDate(end);

  const rows = await env.DB.prepare(`
    SELECT id, date, category, title, notes
    FROM calendar_items
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC
  `).bind(from, to).all();

  return rows.results;
}

function isoDate(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}