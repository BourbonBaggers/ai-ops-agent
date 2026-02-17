import { json, normalizePath } from "../lib/utils.js";

export async function handleWeekly(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path !== "/admin/weekly" || method !== "GET") {
    return json({ status: "error", message: "Not found" }, 404);
  }

  let week_of = url.searchParams.get("week_of");

  if (!week_of) {
    // default to current week (Monday) in America/Chicago
    week_of = currentWeekOf("America/Chicago");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(week_of)) {
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

function safeJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function currentWeekOf(tz) {
  const now = new Date();
  const parts = chicagoParts(now, tz); // y/m/d in tz
  const d = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  const dowIdx = d.getUTCDay();      // 0=Sun..6=Sat
  const mondayOffset = (dowIdx + 6) % 7;
  d.setUTCDate(d.getUTCDate() - mondayOffset);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function chicagoParts(now, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const p = fmt.formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}