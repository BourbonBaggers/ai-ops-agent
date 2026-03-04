import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf, getPartsInTz } from "../lib/time.js";
import { loadSettings } from "../lib/settings.js";
import { generateCandidatesForWeek } from "./candidates.js";
import { selectCandidateForContact } from "../lib/segmentation.js";
import { graphSendMail } from "../lib/ms_graph.js";
import { mergeCandidateIntoTemplate } from "../lib/template_merge.js";
import { DEFAULT_EMAIL_TEMPLATE } from "../lib/default_email_template.js";


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
  const startedAt = nowZ || nowUtcIso();
  const dryRun = isDryRun(env);
  const templateHtml = await resolveTemplateHtml(env);

  // If not locked yet, lock it right now (enforces “auto-authorized”)
  if (run && !run.locked_at) {
    await lockWeeklyRun(env, run, startedAt);
    run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE id = ?`).bind(run.id).first();
  }

  // Ensure we have a selected candidate (lock should have done this, but belt+suspenders)
  if (run && !run.selected_candidate_id) {
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
      `).bind(first.id, startedAt, run.id).run();

      run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE id = ?`).bind(run.id).first();
    }
  }

  const candidateRows = await env.DB.prepare(`
    SELECT id, funnel_stage, subject, preview_text, body_markdown, body_html, image_url, action_line, quote_text, rally_line
    FROM candidates
    WHERE weekly_run_id = ?
    ORDER BY rank ASC
  `).bind(run.id).all();
  const candidateById = new Map((candidateRows.results || []).map((c) => [c.id, c]));

  if (!candidateRows.results?.length) return false; // no candidates generated yet — skip silently

  const activeContacts = await env.DB.prepare(`
    SELECT id, email, order_count
    FROM contacts
    WHERE status = 'active'
    ORDER BY id
  `).all();

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

  const sendRows = await env.DB.prepare(`
    SELECT id, candidate_id, subject, preview_text, body_html, body_text
    FROM sends
    WHERE weekly_run_id = ?
  `).bind(run.id).all();
  const sendByCandidateId = new Map((sendRows.results || []).map((row) => [row.candidate_id, row]));

  const sendMail = typeof env.GRAPH_SEND_IMPL === "function" ? env.GRAPH_SEND_IMPL : graphSendMail;

  const summary = {
    contacts_total: activeContacts.results?.length ?? 0,
    attempted: 0,
    sent_success: 0,
    failed: 0,
    dry_run_count: 0,
    skipped_already_sent: 0,
    top_count: 0,
    mid_count: 0,
    bottom_count: 0,
    errors: [],
    sample: [],
  };

  for (const contact of activeContacts.results ?? []) {
    const selectedForContact = selectCandidateForContact(candidateRows.results ?? [], contact, run);
    const stage = selectedForContact.funnel_stage;
    if (stage === "top" || stage === "mid" || stage === "bottom") {
      summary[`${stage}_count`] += 1;
    }

    let send = sendByCandidateId.get(selectedForContact.id);
    if (!send) {
      const merged = mergeCandidateIntoTemplate(templateHtml, selectedForContact, {
        assetLibraryUrl: env.ASSET_LIBRARY_URL || "https://assets.boozebaggers.com",
        unsubscribeLink: "%%unsubscribe%%",
      });
      const bodyHtml = ensurePreheader(merged, selectedForContact.preview_text);
      const bodyText = (selectedForContact.body_markdown || "").replace(/\r\n/g, "\n");
      const sendId = crypto.randomUUID();

      const insert = await env.DB.prepare(`
        INSERT OR IGNORE INTO sends (
          id, weekly_run_id, candidate_id,
          subject, preview_text, body_html, body_text,
          sender_mailbox, reply_to, tracking_salt, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        sendId,
        run.id,
        selectedForContact.id,
        selectedForContact.subject,
        selectedForContact.preview_text,
        bodyHtml,
        bodyText,
        senderMailbox,
        replyTo,
        crypto.randomUUID(),
        startedAt
      ).run();

      const didInsert = (insert?.meta?.changes ?? 0) > 0;
      if (!didInsert) {
        send = await env.DB.prepare(`
          SELECT id, candidate_id, subject, preview_text, body_html, body_text
          FROM sends
          WHERE weekly_run_id = ? AND candidate_id = ?
          LIMIT 1
        `).bind(run.id, selectedForContact.id).first();
      } else {
        send = {
          id: sendId,
          candidate_id: selectedForContact.id,
          subject: selectedForContact.subject,
          preview_text: selectedForContact.preview_text,
          body_html: bodyHtml,
          body_text: bodyText,
        };
      }

      sendByCandidateId.set(selectedForContact.id, send);
    }

    if (!send?.id) {
      throw new Error(`Unable to resolve send artifact for candidate ${selectedForContact.id}`);
    }

    const existingDelivery = await env.DB.prepare(`
      SELECT id, status
      FROM send_deliveries
      WHERE send_id = ? AND contact_id = ?
      LIMIT 1
    `).bind(send.id, contact.id).first();

    if (existingDelivery) {
      summary.skipped_already_sent += 1;
      continue;
    }

    const deliveryId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO send_deliveries
        (id, send_id, weekly_run_id, candidate_id, contact_id, recipient_email, funnel_stage, status, graph_status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)
    `).bind(
      deliveryId,
      send.id,
      run.id,
      selectedForContact.id,
      contact.id,
      contact.email,
      stage,
      startedAt
    ).run();

    summary.attempted += 1;

    const candidate = candidateById.get(selectedForContact.id) || selectedForContact;
    const candidateBodyHtml = send.body_html?.trim()
      ? send.body_html
      : ensurePreheader(
          mergeCandidateIntoTemplate(templateHtml, candidate, {
            assetLibraryUrl: env.ASSET_LIBRARY_URL || "https://assets.boozebaggers.com",
            unsubscribeLink: "%%unsubscribe%%",
          }),
          candidate.preview_text
        );
    const candidateBodyText = (send.body_text || candidate.body_markdown || "").replace(/\r\n/g, "\n");

    if (dryRun) {
      await env.DB.prepare(`
        UPDATE send_deliveries
        SET status = 'dry_run',
            graph_status = NULL,
            error = NULL
        WHERE id = ?
      `).bind(deliveryId).run();
      summary.dry_run_count += 1;
      if (summary.sample.length < 10) {
        summary.sample.push({ contact_id: contact.id, status: "dry_run", funnel_stage: stage });
      }
      continue;
    }

    try {
      const result = await sendMail(env, {
        fromUpn: senderMailbox,
        to: contact.email,
        subject: candidate.subject,
        html: candidateBodyHtml,
        text: candidateBodyText,
      });

      await env.DB.prepare(`
        UPDATE send_deliveries
        SET status = 'sent',
            graph_status = ?,
            error = NULL
        WHERE id = ?
      `).bind(result?.status ?? null, deliveryId).run();

      summary.sent_success += 1;
      if (summary.sample.length < 10) {
        summary.sample.push({ contact_id: contact.id, status: "sent", funnel_stage: stage });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      await env.DB.prepare(`
        UPDATE send_deliveries
        SET status = 'failed',
            graph_status = NULL,
            error = ?
        WHERE id = ?
      `).bind(msg, deliveryId).run();

      summary.failed += 1;
      summary.errors.push({ contact_id: contact.id, email: contact.email, error: msg });
      if (summary.sample.length < 10) {
        summary.sample.push({ contact_id: contact.id, status: "failed", funnel_stage: stage, error: msg });
      }
    }
  }

  if (summary.sent_success > 0) {
    await env.DB.prepare(`
      UPDATE weekly_runs
      SET sent_at = ?, status = 'sent', updated_at = ?
      WHERE id = ?
    `).bind(startedAt, startedAt, run.id).run();
  }

  const finishedAt = nowUtcIso();
  const errorRollup = buildErrorRollup(summary.errors);
  await env.DB.prepare(`
    INSERT INTO run_log (
      id, weekly_run_id, started_at, finished_at, dry_run,
      contacts_total, attempted, sent_success, failed, skipped_already_sent,
      dry_run_count, top_count, mid_count, bottom_count, error_rollup_json, sample_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    run.id,
    startedAt,
    finishedAt,
    dryRun ? 1 : 0,
    summary.contacts_total,
    summary.attempted,
    summary.sent_success,
    summary.failed,
    summary.skipped_already_sent,
    summary.dry_run_count,
    summary.top_count,
    summary.mid_count,
    summary.bottom_count,
    JSON.stringify(errorRollup),
    JSON.stringify(summary.sample)
  ).run();

  console.log("[sendWeeklyRun] batch_summary", JSON.stringify({
    stage: "send",
    weekly_run_id: run.id,
    week_of: run.week_of,
    dry_run: dryRun,
    contacts_total: summary.contacts_total,
    attempted: summary.attempted,
    dry_run_count: summary.dry_run_count,
    skipped_already_sent: summary.skipped_already_sent,
    sent_success: summary.sent_success,
    failed: summary.failed,
    by_funnel: {
      top: summary.top_count,
      mid: summary.mid_count,
      bottom: summary.bottom_count,
    },
    error_rollup: errorRollup,
    sample: summary.sample,
  }));

  return summary.sent_success > 0;
}

async function resolveTemplateHtml(env) {
  const raw = env?.EMAIL_TEMPLATE_HTML;
  if (typeof raw === "string" && raw.trim()) return raw;

  try {
    const row = await env.DB.prepare(`
      SELECT value_json
      FROM config
      WHERE key = 'email_template_html'
      LIMIT 1
    `).first();

    if (row?.value_json) {
      const parsed = JSON.parse(row.value_json);
      if (typeof parsed === "string" && parsed.trim()) return parsed;
      if (parsed && typeof parsed.html === "string" && parsed.html.trim()) return parsed.html;
    }
  } catch {
    // Fall back to default template if config table/key is unavailable.
  }

  return DEFAULT_EMAIL_TEMPLATE;
}

function ensurePreheader(html, previewText) {
  if (typeof html !== "string") return html;
  const preview = String(previewText ?? "").trim();
  if (!preview) return html;
  if (html.includes(preview)) return html;

  const escaped = escapeHtml(preview);
  const block =
    `<div style="display:none!important;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escaped}</div>`;

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${block}`);
  }
  return `${block}${html}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildErrorRollup(errors) {
  const byMessage = {};
  for (const e of errors || []) {
    const key = e?.error || "unknown_error";
    byMessage[key] = (byMessage[key] || 0) + 1;
  }
  return { total: errors?.length || 0, by_message: byMessage };
}

export function isDryRun(env) {
  const raw = env?.DRY_RUN;
  if (raw === true) return true;
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}
