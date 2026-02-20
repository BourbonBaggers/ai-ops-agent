// src/routes/admin_preview.js — read-only preview of what would be sent for a week
import { json } from "../lib/utils.js";
import { isYmd } from "../lib/time.js";

export async function handleAdminPreview(request, env) {
  if (request.method !== "GET") {
    return json({ status: "error", message: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const week_of = url.searchParams.get("week_of");

  if (!isYmd(week_of)) {
    return json({ status: "error", message: "week_of must be YYYY-MM-DD" }, 400);
  }

  // All queries below are read-only SELECT — no writes, no locks, no side effects.

  // 1. Weekly run
  const run = await env.DB.prepare(
    `SELECT * FROM weekly_runs WHERE week_of = ?`
  ).bind(week_of).first();

  if (!run) {
    return json({ status: "ok", week_of, preview: null, reason: "no weekly run for this week" });
  }

  // 2. Candidates
  const candidateRows = await env.DB.prepare(
    `SELECT id, rank, subject, preview_text, body_markdown
     FROM candidates WHERE weekly_run_id = ? ORDER BY rank ASC`
  ).bind(run.id).all();

  const candidates = candidateRows.results ?? [];

  if (candidates.length === 0) {
    return json({
      status: "ok",
      week_of,
      run_status: run.status,
      preview: null,
      reason: "no candidates generated yet",
    });
  }

  // 3. If a sends row already exists, return it directly — that IS what was sent.
  const send = await env.DB.prepare(
    `SELECT id, weekly_run_id, candidate_id,
            subject, preview_text, body_html, body_text,
            sender_mailbox, reply_to, tracking_salt, created_at
     FROM sends WHERE weekly_run_id = ? LIMIT 1`
  ).bind(run.id).first();

  if (send) {
    return json({ status: "ok", week_of, run_status: run.status, state: "sent", preview: send });
  }

  // 4. No sends row yet.
  //    If not locked: show all candidates with auto-lock indicator (rank 1 always wins).
  if (!run.locked_at) {
    const autoLockId = candidates[0].id;
    return json({
      status: "ok",
      week_of,
      run_status: run.status,
      state: "unlocked",
      preview: null,
      reason: `${candidates.length} candidate(s) exist but run is not yet locked`,
      auto_lock_candidate_id: autoLockId,
      candidates: candidates.map(c => ({
        id: c.id,
        rank: c.rank,
        subject: c.subject,
        preview_text: c.preview_text,
        body_markdown: c.body_markdown,
        will_auto_lock: c.id === autoLockId,
      })),
    });
  }

  // 5. Locked, no sends yet — construct the preview the same way sendStub would,
  //    but with zero side effects (no DB write, no Graph call).
  const selectedCandidate =
    candidates.find(c => c.id === run.selected_candidate_id) ?? candidates[0];

  const isDev = (env.ENVIRONMENT || "").toLowerCase() === "dev";
  const senderMailbox =
    env.MAIL_SENDER_UPN ||
    env.SENDER_MAILBOX ||
    (isDev ? "stub-sender@example.com" : null);
  const replyTo =
    env.REPLY_TO ||
    (isDev ? "stub-replyto@example.com" : null);

  const bodyHtml =
    `<pre style="white-space:pre-wrap;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
    `${escapeHtml(selectedCandidate.body_markdown || "")}</pre>`;
  const bodyText = (selectedCandidate.body_markdown || "").replace(/\r\n/g, "\n");

  return json({
    status: "ok",
    week_of,
    run_status: run.status,
    state: "locked",
    preview: {
      weekly_run_id: run.id,
      candidate_id: selectedCandidate.id,
      subject: selectedCandidate.subject,
      preview_text: selectedCandidate.preview_text,
      body_html: bodyHtml,
      body_text: bodyText,
      sender_mailbox: senderMailbox,
      reply_to: replyTo,
    },
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
