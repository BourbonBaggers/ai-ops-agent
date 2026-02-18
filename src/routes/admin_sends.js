// src/routes/admin_sends.js
import { json } from "../lib/utils.js";

export async function handleAdminSends(request, env) {
  const url = new URL(request.url);
  const weekly_run_id = url.searchParams.get("weekly_run_id");

  if (!weekly_run_id) {
    return json({ status: "error", error: "weekly_run_id is required" }, 400);
  }

  // If you want more fields, join candidates. For now keep it stable.
  const rows = await env.DB.prepare(
    `SELECT id, weekly_run_id, candidate_id, subject, created_at
     FROM sends
     WHERE weekly_run_id = ?
     ORDER BY created_at DESC`
  )
    .bind(weekly_run_id)
    .all();

  return json({
    status: "ok",
    weekly_run_id,
    sends: rows.results ?? [],
  });
}