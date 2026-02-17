import { json, normalizePath, nowIso } from "../lib/utils.js";
import { MockProvider } from "../providers/mockProvider.js";

export async function handleCandidates(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/candidates" && method === "GET") {
    const week_of = url.searchParams.get("week_of");
    if (!isDate(week_of)) return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);

    const run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
      .bind(week_of)
      .first();
    if (!run) return json({ status: "ok", week_of, count: 0, candidates: [] });

    const rows = await env.DB.prepare(`
      SELECT id, weekly_run_id, rank, subject, preview_text, body_markdown, cta, image_refs_json, self_check_json, created_at
      FROM candidates
      WHERE weekly_run_id = ?
      ORDER BY rank ASC
    `).bind(run.id).all();

    return json({
      status: "ok",
      week_of,
      weekly_run_id: run.id,
      count: rows.results.length,
      candidates: rows.results.map(hydrateCandidateRow)
    });
  }

  if (path === "/admin/candidates/generate" && method === "POST") {
    const week_of = url.searchParams.get("week_of");
    if (!isDate(week_of)) return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);

    // Ensure weekly_run exists
    const run = await ensureWeeklyRun(env, week_of);

    // Pull active policy
    const policy = await env.DB.prepare(`
      SELECT id, title, body_markdown, created_at
      FROM policy_versions
      WHERE is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).first();

    if (!policy) {
      return json({ status: "error", message: "No active policy found. Load/activate a policy first." }, 400);
    }

    // Pull calendar items for next 90 days (relative to now)
    const horizon = await getCalendarHorizon(env, 90);

    // Delete existing candidates for this week (repeatable)
    await env.DB.prepare(`DELETE FROM candidates WHERE weekly_run_id = ?`).bind(run.id).run();

    // Generate 3 candidates
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

    const now = nowIso();
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

    return json({ status: "ok", week_of, weekly_run_id: run.id, generated: generated.length });
  }

  return json({ status: "error", message: "Not found" }, 404);
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
  await env.DB.prepare(`
    INSERT INTO weekly_runs (id, week_of, status)
    VALUES (?, ?, 'pending')
  `).bind(id, week_of).run();

  run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  return run;
}

async function getCalendarHorizon(env, days) {
  // Use UTC for storage filtering; dates are YYYY-MM-DD strings so lexical compares work.
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