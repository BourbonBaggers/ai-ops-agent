import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf, getPartsInTz } from "../lib/time.js";
import { loadSettings } from "../lib/settings.js";
import { generateCandidatesForWeek } from "./candidates.js";
import { selectCandidateForContact } from "../lib/segmentation.js";
import { graphSendMail } from "../lib/ms_graph.js";


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
    const didSend = await sendWeeklyRun(env, run3, nowUtc);
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

export async function sendWeeklyRun(env, run, nowZ) {
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

  const candidateRows = await env.DB.prepare(`
    SELECT id, funnel_stage
    FROM candidates
    WHERE weekly_run_id = ?
    ORDER BY rank ASC
  `).bind(run.id).all();

  const activeContacts = await env.DB.prepare(`
    SELECT id, order_count
    FROM contacts
    WHERE status = 'active'
    ORDER BY id
  `).all();

  const stageCounts = { top: 0, mid: 0, bottom: 0 };
  for (const contact of activeContacts.results ?? []) {
    const selected = selectCandidateForContact(candidateRows.results ?? [], contact, run);
    if (selected?.funnel_stage === "top" || selected?.funnel_stage === "mid" || selected?.funnel_stage === "bottom") {
      stageCounts[selected.funnel_stage] += 1;
    }
  }

  console.log("[sendWeeklyRun] selected_funnel_stage_counts", JSON.stringify({
    week_of: run.week_of,
    total_contacts: activeContacts.results?.length ?? 0,
    counts: stageCounts,
  }));

  const isDev = (env.ENVIRONMENT || "").toLowerCase() === "dev";

  // Support both legacy + current names
  const senderMailbox =
    env.GRAPH_SENDER_EMAIL ||
    env.MAIL_SENDER_UPN ||
    env.SENDER_MAILBOX ||
    env.MS_SENDER_UPN ||
    (isDev ? "stub-sender@example.com" : null);

  const replyTo =
    env.REPLY_TO ||
    (isDev ? "stub-replyto@example.com" : null);

  if (!senderMailbox || !replyTo) {
    throw new Error(
      "Missing required mail environment variables. Expected GRAPH_SENDER_EMAIL (or MAIL_SENDER_UPN/SENDER_MAILBOX/MS_SENDER_UPN) and REPLY_TO."
    );
  }

  const bodyHtml = cand.body_html?.trim()
    ? cand.body_html
    : `<pre style="white-space:pre-wrap;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(
        cand.body_markdown || ""
      )}</pre>`;
  const bodyText = (cand.body_text || cand.body_markdown || "").replace(/\r\n/g, "\n");

  let send = await env.DB.prepare(`
    SELECT id, tracking_salt
    FROM sends
    WHERE weekly_run_id = ? AND candidate_id = ?
    LIMIT 1
  `).bind(run.id, cand.id).first();

  if (!send) {
    const sendId = crypto.randomUUID();
    const trackingSalt = crypto.randomUUID();

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

    send = { id: sendId, tracking_salt: trackingSalt };
  }

  const contactsRes = await env.DB.prepare(`
    SELECT id, email, order_count
    FROM contacts
    WHERE status = 'active'
    ORDER BY COALESCE(lastname,''), COALESCE(firstname,''), email
  `).all();

  let sentCount = 0;
  const errors = [];

  for (const contact of contactsRes.results ?? []) {
    const existing = await env.DB.prepare(`
      SELECT id, status
      FROM send_recipients
      WHERE send_id = ? AND contact_id = ?
      LIMIT 1
    `).bind(send.id, contact.id).first();

    if (existing?.status === "sent") {
      continue;
    }

    try {
      const selectedForContact = selectCandidateForContact(candidateRows.results ?? [], contact, run);
      const result = await graphSendMail(env, {
        fromUpn: senderMailbox,
        to: contact.email,
        subject: cand.subject,
        html: bodyHtml,
        text: bodyText,
      });

      const providerMessageId = result?.id || result?.messageId || null;

      if (existing?.id) {
        await env.DB.prepare(`
          UPDATE send_recipients
          SET status = 'sent',
              provider_message_id = ?,
              error = NULL,
              sent_at = ?
          WHERE id = ?
        `).bind(providerMessageId, nowZ, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO send_recipients
            (id, send_id, contact_id, email, status, provider_message_id, error, sent_at, created_at)
          VALUES (?, ?, ?, ?, 'sent', ?, NULL, ?, ?)
        `).bind(
          crypto.randomUUID(),
          send.id,
          contact.id,
          contact.email,
          providerMessageId,
          nowZ,
          nowZ
        ).run();
      }

      sentCount++;
      console.log("[sendWeeklyRun] delivered", JSON.stringify({
        weekly_run_id: run.id,
        contact_id: contact.id,
        funnel_stage: selectedForContact.funnel_stage,
      }));
    } catch (err) {
      const msg = err?.message || String(err);
      errors.push({ contact_id: contact.id, email: contact.email, error: msg });
      console.error("[sendWeeklyRun] delivery_failed", JSON.stringify({
        weekly_run_id: run.id,
        contact_id: contact.id,
        email: contact.email,
        error: msg,
      }));

      if (existing?.id) {
        await env.DB.prepare(`
          UPDATE send_recipients
          SET status = 'failed',
              error = ?,
              sent_at = NULL
          WHERE id = ?
        `).bind(msg, existing.id).run();
      } else {
        await env.DB.prepare(`
          INSERT INTO send_recipients
            (id, send_id, contact_id, email, status, provider_message_id, error, sent_at, created_at)
          VALUES (?, ?, ?, ?, 'failed', NULL, ?, NULL, ?)
        `).bind(
          crypto.randomUUID(),
          send.id,
          contact.id,
          contact.email,
          msg,
          nowZ
        ).run();
      }
    }
  }

  if (sentCount > 0) {
    await env.DB.prepare(`
      UPDATE weekly_runs
      SET sent_at = ?, status = 'sent', updated_at = ?
      WHERE id = ?
    `).bind(nowZ, nowZ, run.id).run();
  }

  if (errors.length) {
    console.error("[sendWeeklyRun] error_summary", JSON.stringify({
      weekly_run_id: run.id,
      failed: errors.length,
      sent: sentCount,
      errors,
    }));
  }

  return sentCount > 0;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
