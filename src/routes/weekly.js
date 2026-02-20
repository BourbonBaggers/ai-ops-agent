import { json, normalizePath, safeJson } from "../lib/utils.js";
import { isYmd } from "../lib/time.js";

export async function handleWeekly(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path !== "/admin/weekly" || method !== "GET") {
    return json({ status: "error", message: "Not found" }, 404);
  }

  let week_of = url.searchParams.get("week_of");


  if (!isYmd(week_of)) {
    return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);
  }

  const run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();

  if (!run) {
    return json({ status: "ok", week_of, weekly_run: null, candidates: [], selected: null });
  }

  const cand = await env.DB.prepare(`
    SELECT id, rank, subject, preview_text, body_markdown, cta, image_refs_json, self_check_json, created_at
    FROM candidates
    WHERE weekly_run_id = ?
    ORDER BY rank ASC
  `).bind(run.id).all();

  const selected = run.selected_candidate_id
    ? await env.DB.prepare(`
        SELECT id, rank, subject, preview_text, body_markdown, cta
        FROM candidates
        WHERE id = ?
        LIMIT 1
      `).bind(run.selected_candidate_id).first()
    : null;

  return json({
    status: "ok",
    week_of,
    weekly_run: run,
    candidates: cand.results.map(r => ({
      ...r,
      image_refs: safeJson(r.image_refs_json, []),
      self_check: safeJson(r.self_check_json, {})
    })),
    selected
  });
}

