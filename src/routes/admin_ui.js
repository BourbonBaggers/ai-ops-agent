import {
  json,
  normalizePath,
  requireJsonBody,
  strOrNull,
  safeJson,
} from "../lib/utils.js";
import { mergeCandidateIntoTemplate } from "../lib/template_merge.js";
import { DEFAULT_EMAIL_TEMPLATE } from "../lib/default_email_template.js";

const STAGES = ["top", "mid", "bottom"];

export async function handleAdminUi(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/ui" && method === "GET") {
    return new Response(renderAdminUiHtml(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/admin/ui/app.js" && method === "GET") {
    return new Response(getClientScript(), {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  if (path === "/admin/ui_api/preview" && method === "GET") {
    return previewCandidate(url, env);
  }

  if (path === "/admin/ui_api/sends" && method === "GET") {
    return listSendSummary(url, env);
  }

  if (path === "/admin/ui_api/sends/recipients" && method === "GET") {
    return listSendRecipients(url, env);
  }

  if (path.startsWith("/admin/ui_api/candidates/") && method === "PATCH") {
    const candidateId = path.split("/").pop();
    return updateCandidate(candidateId, request, env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function previewCandidate(url, env) {
  const candidateId = (url.searchParams.get("candidate_id") || "").trim();
  if (!candidateId) {
    return json({ status: "error", message: "candidate_id is required" }, 400);
  }

  const candidate = await env.DB.prepare(`
    SELECT id, weekly_run_id, subject, preview_text, body_markdown, body_html, image_url,
           cta, action_line, quote_text, rally_line, funnel_stage, self_check_json, created_at
    FROM candidates
    WHERE id = ?
    LIMIT 1
  `).bind(candidateId).first();

  if (!candidate) {
    return json({ status: "error", message: "Candidate not found" }, 404);
  }

  const resolvedImageAlt =
    candidateImageAlt(candidate) ||
    (candidate.image_url ? await lookupImageAltByUrl(env, candidate.image_url) : null) ||
    candidate.subject ||
    "Product image";

  const templateHtml = await resolveTemplateHtml(env);
  const mergedHtml = ensurePreheader(
    mergeCandidateIntoTemplate(templateHtml, candidate, {
      assetLibraryUrl: env.ASSET_LIBRARY_URL || "https://assets.boozebaggers.com",
      unsubscribeLink: "%%unsubscribe%%",
      imageAlt: resolvedImageAlt,
    }),
    candidate.preview_text
  );

  return json({
    status: "ok",
    candidate_id: candidate.id,
    funnel_stage: candidate.funnel_stage || null,
    subject: candidate.subject,
    preview_text: candidate.preview_text,
    image_alt: resolvedImageAlt,
    merged_html: mergedHtml,
    plain_text: (candidate.body_markdown || "").replace(/\r\n/g, "\n"),
  });
}

async function listSendSummary(url, env) {
  const weeklyRunId = (url.searchParams.get("weekly_run_id") || "").trim();
  if (!weeklyRunId) {
    return json({ status: "error", message: "weekly_run_id is required" }, 400);
  }

  const rows = await env.DB.prepare(`
    SELECT
      s.id,
      s.weekly_run_id,
      s.candidate_id,
      s.subject,
      s.created_at,
      c.funnel_stage,
      SUM(CASE WHEN d.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
      SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN d.status = 'dry_run' THEN 1 ELSE 0 END) AS dry_run_count
    FROM sends s
    LEFT JOIN send_deliveries d ON d.send_id = s.id
    LEFT JOIN candidates c ON c.id = s.candidate_id
    WHERE s.weekly_run_id = ?
    GROUP BY s.id, s.weekly_run_id, s.candidate_id, s.subject, s.created_at, c.funnel_stage
    ORDER BY s.created_at DESC
  `).bind(weeklyRunId).all();

  return json({
    status: "ok",
    weekly_run_id: weeklyRunId,
    sends: (rows.results || []).map((row) => ({
      ...row,
      sent_count: Number(row.sent_count || 0),
      failed_count: Number(row.failed_count || 0),
      dry_run_count: Number(row.dry_run_count || 0),
    })),
  });
}

async function listSendRecipients(url, env) {
  const sendId = (url.searchParams.get("send_id") || "").trim();
  if (!sendId) {
    return json({ status: "error", message: "send_id is required" }, 400);
  }

  const rows = await env.DB.prepare(`
    SELECT
      d.id,
      d.send_id,
      d.contact_id,
      d.recipient_email,
      d.funnel_stage,
      d.status,
      d.graph_status,
      d.error,
      d.created_at,
      c.firstname,
      c.lastname
    FROM send_deliveries d
    LEFT JOIN contacts c ON c.id = d.contact_id
    WHERE d.send_id = ?
    ORDER BY d.created_at ASC, d.id ASC
  `).bind(sendId).all();

  return json({
    status: "ok",
    send_id: sendId,
    recipients: (rows.results || []).map((row) => ({
      ...row,
      contact_name: formatName(row.firstname, row.lastname),
    })),
  });
}

async function updateCandidate(candidateId, request, env) {
  if (!candidateId) {
    return json({ status: "error", message: "candidate id is required" }, 400);
  }

  const body = await requireJsonBody(request);
  const existing = await env.DB.prepare(`
    SELECT c.id, c.weekly_run_id, wr.locked_at
           , c.self_check_json
    FROM candidates c
    JOIN weekly_runs wr ON wr.id = c.weekly_run_id
    WHERE c.id = ?
    LIMIT 1
  `).bind(candidateId).first();

  if (!existing) {
    return json({ status: "error", message: "Candidate not found" }, 404);
  }

  if (existing.locked_at) {
    return json({ status: "error", message: "Candidate is locked" }, 409);
  }

  const updates = [];
  const args = [];

  setRequiredStringField(body, updates, args, "subject", "subject");
  setRequiredStringField(body, updates, args, "preview_text", "preview_text");
  setNullableStringField(body, updates, args, "image_url", "image_url");
  setRequiredStringField(body, updates, args, "body_html", "body_html");

  const bodyTextProvided = Object.prototype.hasOwnProperty.call(body, "body_text");
  const bodyMarkdownProvided = Object.prototype.hasOwnProperty.call(body, "body_markdown");
  if (bodyTextProvided && !bodyMarkdownProvided) {
    body.body_markdown = body.body_text;
  }
  setRequiredStringField(body, updates, args, "body_markdown", "body_markdown");

  setNullableStringField(body, updates, args, "cta", "cta");
  setNullableStringField(body, updates, args, "action_line", "action_line");
  setNullableStringField(body, updates, args, "quote_text", "quote_text");
  setNullableStringField(body, updates, args, "rally_line", "rally_line");
  setImageAltField(body, updates, args, existing);

  if (updates.length === 0) {
    return json({ status: "error", message: "No editable fields provided" }, 400);
  }

  await env.DB.prepare(`
    UPDATE candidates
    SET ${updates.join(", ")}
    WHERE id = ?
  `).bind(...args, candidateId).run();

  const updated = await env.DB.prepare(`
    SELECT id, weekly_run_id, rank, subject, preview_text, body_markdown, cta,
           funnel_stage, body_html, image_url, action_line, quote_text, rally_line,
           image_refs_json, self_check_json, created_at
    FROM candidates
    WHERE id = ?
    LIMIT 1
  `).bind(candidateId).first();

  return json({
    status: "ok",
    candidate: {
      ...updated,
      body_text: updated?.body_markdown || "",
      image_alt: candidateImageAlt(updated),
    },
  });
}

function setRequiredStringField(body, updates, args, bodyKey, columnName) {
  if (!Object.prototype.hasOwnProperty.call(body, bodyKey)) return;
  const value = typeof body[bodyKey] === "string" ? body[bodyKey].trim() : "";
  if (!value) {
    const err = new Error(`${bodyKey} must be a non-empty string`);
    err.status = 400;
    throw err;
  }
  updates.push(`${columnName} = ?`);
  args.push(value);
}

function setNullableStringField(body, updates, args, bodyKey, columnName) {
  if (!Object.prototype.hasOwnProperty.call(body, bodyKey)) return;
  updates.push(`${columnName} = ?`);
  args.push(strOrNull(body[bodyKey]));
}

function setImageAltField(body, updates, args, existing) {
  if (!Object.prototype.hasOwnProperty.call(body, "image_alt")) return;
  const existingSelfCheck = safeJson(existing?.self_check_json, {});
  const nextSelfCheck =
    existingSelfCheck && typeof existingSelfCheck === "object" && !Array.isArray(existingSelfCheck)
      ? { ...existingSelfCheck }
      : {};
  const imageAlt = strOrNull(body.image_alt);
  if (imageAlt) nextSelfCheck.image_alt = imageAlt;
  else delete nextSelfCheck.image_alt;
  updates.push("self_check_json = ?");
  args.push(JSON.stringify(nextSelfCheck));
}

function candidateImageAlt(candidate) {
  const parsed = safeJson(candidate?.self_check_json, {});
  const alt = parsed && typeof parsed === "object" ? parsed.image_alt : null;
  return typeof alt === "string" && alt.trim() ? alt.trim() : null;
}

async function lookupImageAltByUrl(env, imageUrl) {
  const url = strOrNull(imageUrl);
  if (!url) return null;
  try {
    const row = await env.DB.prepare(`
      SELECT alt
      FROM email_images
      WHERE url = ?
      LIMIT 1
    `).bind(url).first();
    const alt = strOrNull(row?.alt);
    return alt;
  } catch {
    return null;
  }
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
    // Fall through to default template.
  }

  return DEFAULT_EMAIL_TEMPLATE;
}

function ensurePreheader(html, previewText) {
  if (typeof html !== "string") return html;
  const preview = String(previewText ?? "").trim();
  if (!preview || html.includes(preview)) return html;

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

function formatName(firstname, lastname) {
  const first = String(firstname || "").trim();
  const last = String(lastname || "").trim();
  const full = `${first} ${last}`.trim();
  return full || null;
}

function renderAdminUiHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin UI</title>
  <style>
    :root {
      --bg: #f2efe8;
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --accent: #1d4ed8;
      --ok: #166534;
      --warn: #b45309;
      --error: #b91c1c;
      --line: #e5e7eb;
      --mono: "SFMono-Regular", Menlo, Monaco, Consolas, monospace;
      --sans: "Avenir Next", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: var(--sans); color: var(--ink); background: linear-gradient(180deg, #faf7f2 0%, #f2efe8 50%, #ebe6db 100%); }
    header { position: sticky; top: 0; z-index: 10; padding: 12px 16px; background: rgba(255,255,255,0.92); backdrop-filter: blur(5px); border-bottom: 1px solid var(--line); }
    main { max-width: 1300px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .card { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: #fff; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; background: #eff6ff; color: #1d4ed8; }
    .badge.locked { background: #fef3c7; color: #92400e; }
    .badge.missing { background: #fee2e2; color: #991b1b; }
    h1,h2,h3 { margin: 0; }
    h2 { font-size: 18px; }
    h3 { font-size: 16px; margin-bottom: 8px; }
    .muted { color: var(--muted); font-size: 13px; }
    button { border: 1px solid var(--line); background: #fff; color: var(--ink); padding: 6px 10px; border-radius: 8px; cursor: pointer; }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    input, select, textarea { width: 100%; padding: 8px; border: 1px solid #d1d5db; border-radius: 8px; font: inherit; }
    textarea { min-height: 110px; resize: vertical; }
    textarea.mono { font-family: var(--mono); font-size: 12px; }
    .editor-toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
    .editor-toolbar button { padding: 4px 8px; font-size: 12px; }
    .html-editor { min-height: 180px; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px; background: #fff; font-family: var(--sans); overflow: auto; }
    .html-editor:focus { outline: 2px solid #bfdbfe; outline-offset: 1px; }
    .field-help { font-size: 12px; color: var(--muted); margin-top: 4px; }
    iframe { width: 100%; height: 560px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 8px; font-size: 13px; vertical-align: top; }
    .toast { min-height: 22px; font-size: 13px; }
    .toast.error { color: var(--error); }
    .toast.ok { color: var(--ok); }
    details.debug { background: #f8fafc; border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
    details.debug summary { cursor: pointer; font-weight: 600; }
    .debug-grid { display: grid; gap: 8px; margin-top: 8px; }
    .debug-box { border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 8px; }
    .debug-box h4 { margin: 0 0 6px 0; font-size: 12px; text-transform: uppercase; color: #475569; }
    .debug-box pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; font-family: var(--mono); max-height: 180px; overflow: auto; }
    @media (max-width: 920px) {
      iframe { height: 360px; }
      .split { grid-template-columns: 1fr; }
    }
    @media (min-width: 921px) {
      .split { display: grid; grid-template-columns: 1.1fr .9fr; gap: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="row">
      <h1>Admin UI</h1>
      <label for="weekInput" class="muted">Week</label>
      <input id="weekInput" type="date" style="width:auto" />
      <button id="reloadBtn" class="primary">Reload</button>
      <span id="selectedWeekLabel" class="muted"></span>
    </div>
    <div id="toast" class="toast"></div>
  </header>

  <main id="admin-ui-root">
    <section class="panel">
      <h2>Candidates</h2>
      <div id="candidateCards" class="cards" style="margin-top:10px"></div>
    </section>

    <section class="split">
      <div class="panel">
        <h2>Candidate Editor</h2>
        <div id="editorEmpty" class="muted" style="margin-top:8px">Select a candidate to edit.</div>
        <form id="editorForm" style="display:none; margin-top:10px;">
          <div class="row"><div style="flex:1"><label>Candidate ID</label><input id="f_id" disabled /></div><div style="flex:1"><label>Funnel Stage</label><input id="f_stage" disabled /></div></div>
          <label>Subject</label><input id="f_subject" />
          <label>Preview Text</label><input id="f_preview_text" />
          <label>Image URL</label><input id="f_image_url" type="url" list="imageUrlSuggestions" placeholder="https://..." />
          <datalist id="imageUrlSuggestions"></datalist>
          <div class="field-help">Manually editable. Suggestions come from the image catalog.</div>
          <label>Image Alt Text</label><input id="f_image_alt" type="text" placeholder="Describe the image for accessibility" />
          <label>Body HTML</label>
          <div id="htmlToolbar" class="editor-toolbar">
            <button type="button" data-cmd="bold"><b>B</b></button>
            <button type="button" data-cmd="italic"><i>I</i></button>
            <button type="button" data-cmd="insertUnorderedList">• List</button>
            <button type="button" data-cmd="insertOrderedList">1. List</button>
            <button type="button" data-cmd="createLink">Link</button>
            <button type="button" data-cmd="removeFormat">Clear</button>
          </div>
          <div id="f_body_html_editor" class="html-editor" contenteditable="true"></div>
          <textarea id="f_body_html" class="mono" style="display:none"></textarea>
          <label>Body Text</label><textarea id="f_body_text" class="mono"></textarea>
          <div id="optionalFields"></div>
          <div class="row" style="margin-top:8px">
            <button id="saveBtn" type="submit" class="primary">Save</button>
            <button id="previewBtn" type="button">Preview merged</button>
            <span id="lockState" class="muted"></span>
          </div>
        </form>
      </div>

      <div class="panel">
        <h2>Merged Preview</h2>
        <div class="row" style="margin:8px 0">
          <button id="copyHtmlBtn" type="button">Copy merged HTML</button>
          <button id="copyTextBtn" type="button">Copy plain text</button>
        </div>
        <iframe id="previewFrame" title="Merged Preview"></iframe>
      </div>
    </section>

    <section class="panel">
      <h2>Send History</h2>
      <table>
        <thead><tr><th>Send ID</th><th>Created At</th><th>Stage</th><th>Candidate</th><th>Subject</th><th>Sent</th><th>Failed</th><th>Action</th></tr></thead>
        <tbody id="sendRows"></tbody>
      </table>
      <h3 style="margin-top:14px">Recipients</h3>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Error</th><th>Created</th></tr></thead>
        <tbody id="recipientRows"></tbody>
      </table>
    </section>

    <section class="panel">
      <details class="debug" open>
        <summary>Debug</summary>
        <div class="debug-grid">
          <div class="debug-box">
            <h4>State</h4>
            <pre id="debugState">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Connection</h4>
            <pre id="debugConnection">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Weekly JSON</h4>
            <pre id="debugWeekly">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Candidates JSON</h4>
            <pre id="debugCandidates">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Images JSON</h4>
            <pre id="debugImages">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Sends JSON</h4>
            <pre id="debugSends">(pending)</pre>
          </div>
          <div class="debug-box">
            <h4>Errors</h4>
            <pre id="debugErrors">(none)</pre>
          </div>
        </div>
      </details>
    </section>
  </main>

<script src="/admin/ui/app.js"></script>
</body>
</html>`;
}

function getClientScript() {
  return `const __name = (fn) => fn;\n(${clientApp.toString()})(${JSON.stringify(STAGES)});`;
}

function clientApp(stages) {
  const $ = (id) => document.getElementById(id);
  const state = {
    selectedDate: null,
    weekOf: null,
    run: null,
    candidates: [],
    candidatesById: new Map(),
    images: [],
    selectedCandidateId: null,
    locked: false,
    lastPreviewHtml: "",
    lastPreviewText: "",
    debug: {
      connection: "",
      weekly: null,
      candidates: null,
      images: null,
      sends: null,
      errors: [],
    },
  };

  function safe(v, fallback = "") {
    return v === null || v === undefined ? fallback : String(v);
  }

  function bootDebug(message) {
    const el = $("debugErrors");
    if (!el) return;
    const prior = el.textContent && el.textContent !== "(none)" ? el.textContent + "\n" : "";
    el.textContent = prior + message;
  }

  window.addEventListener("error", (event) => {
    bootDebug("[window.error] " + (event?.message || "unknown"));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason?.message || String(event?.reason || "unknown");
    bootDebug("[unhandledrejection] " + reason);
  });

  function setToast(message, type = "") {
    const el = $("toast");
    if (!el) return;
    el.textContent = message || "";
    el.className = ("toast " + type).trim();
  }

  function toYmdToday() {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function weekOfFromDate(selectedDate) {
    const d = new Date(selectedDate + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) return selectedDate;
    const dow = d.getUTCDay();
    const mondayOffset = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    return d.toISOString().slice(0, 10);
  }

  function pushDebugError(msg) {
    state.debug.errors.push({ at: new Date().toISOString(), message: safe(msg) });
    if (state.debug.errors.length > 10) state.debug.errors = state.debug.errors.slice(-10);
  }

  function stringifyDebug(v) {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  function setDebug(id, value) {
    const el = $(id);
    if (!el) return;
    el.textContent = typeof value === "string" ? value : stringifyDebug(value);
  }

  function renderDebug() {
    setDebug("debugState", {
      selected_date: state.selectedDate,
      week_of: state.weekOf,
      weekly_run_id: state.run ? state.run.id : null,
      run_status: state.run ? state.run.status : null,
      locked: state.locked,
      candidate_count: state.candidates.length,
      image_count: state.images.length,
    });
    setDebug("debugConnection", state.debug.connection || "(not checked)");
    setDebug("debugWeekly", state.debug.weekly || "(no data)");
    setDebug("debugCandidates", state.debug.candidates || "(no data)");
    setDebug("debugImages", state.debug.images || "(no data)");
    setDebug("debugSends", state.debug.sends || "(no data)");
    setDebug("debugErrors", state.debug.errors.length ? state.debug.errors : "(none)");
  }

  async function fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const snippet = text.slice(0, 280);
      throw new Error("HTTP " + res.status + " " + res.statusText + ": " + snippet);
    }
    return body;
  }

  function escapeHtml(v) {
    return safe(v)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(v) {
    return escapeHtml(v).replaceAll("`", "&#096;");
  }

  function stageBadge(stage) {
    return '<span class="badge">' + safe(stage, "unknown") + "</span>";
  }
  function lockBadge(locked) {
    return locked ? '<span class="badge locked">Locked</span>' : "";
  }

  function missingCard(stage) {
    return (
      '<article class="card"><div class="row">' +
      stageBadge(stage) +
      ' <span class="badge missing">Not generated yet</span></div><p class="muted">No candidate for this stage in this week.</p></article>'
    );
  }

  function renderCards() {
    const el = $("candidateCards");
    if (!el) return;
    const byStage = new Map();
    for (const c of state.candidates) if (!byStage.has(c.funnel_stage)) byStage.set(c.funnel_stage, c);
    const cards = stages.map((stage) => {
      const c = byStage.get(stage);
      if (!c) return missingCard(stage);
      return (
        '<article class="card"><div class="row">' +
        stageBadge(stage) +
        " " +
        lockBadge(state.locked) +
        "</div><h3>" +
        escapeHtml(safe(c.subject, "(no subject)")) +
        '</h3><p class="muted">' +
        escapeHtml(safe(c.preview_text, "(no preview text)")) +
        '</p><p class="muted">Updated: ' +
        escapeHtml(safe(c.created_at, "(missing)")) +
        '</p><div class="row"><button data-action="manage" data-id="' +
        escapeAttr(c.id) +
        '">Manage</button></div></article>'
      );
    });
    el.innerHTML = cards.join("\n");
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (action === "manage") {
          openEditor(id);
          loadMergedPreview(id);
        }
      });
    });
  }

  function candidateImageAlt(candidate) {
    if (!candidate || typeof candidate !== "object") return "";
    if (typeof candidate.image_alt === "string" && candidate.image_alt.trim()) return candidate.image_alt.trim();
    const sc = candidate.self_check;
    if (sc && typeof sc === "object" && typeof sc.image_alt === "string" && sc.image_alt.trim()) {
      return sc.image_alt.trim();
    }
    return "";
  }

  function renderImageSuggestions() {
    const datalist = $("imageUrlSuggestions");
    if (!datalist) return;
    const options = [];
    const seen = new Set();
    for (const row of state.images) {
      const url = safe(row.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const label = [safe(row.product_name), safe(row.alt)].filter(Boolean).join(" | ");
      options.push('<option value="' + escapeAttr(url) + '" label="' + escapeAttr(label || url) + '"></option>');
    }
    datalist.innerHTML = options.join("\n");
  }

  function imageAltFromCatalog(url) {
    const key = safe(url).trim();
    if (!key) return "";
    const match = state.images.find((row) => safe(row.url).trim() === key);
    return match && typeof match.alt === "string" ? match.alt.trim() : "";
  }

  function maybeFillImageAltFromCatalog() {
    const url = safe($("f_image_url").value).trim();
    const altEl = $("f_image_alt");
    if (!url || !altEl || safe(altEl.value).trim()) return;
    const match = state.images.find((row) => safe(row.url).trim() === url);
    if (match && typeof match.alt === "string" && match.alt.trim()) {
      altEl.value = match.alt.trim();
    }
  }

  function setHtmlEditorValue(html) {
    const editor = $("f_body_html_editor");
    const hidden = $("f_body_html");
    const value = safe(html, "");
    if (editor) editor.innerHTML = value;
    if (hidden) hidden.value = value;
  }

  function syncHtmlEditor() {
    const editor = $("f_body_html_editor");
    const hidden = $("f_body_html");
    if (!editor || !hidden) return "";
    const value = editor.innerHTML;
    hidden.value = value;
    return value;
  }

  function applyHtmlCommand(cmd) {
    const editor = $("f_body_html_editor");
    if (!editor) return;
    editor.focus();
    if (cmd === "createLink") {
      const url = window.prompt("Enter URL", "https://");
      if (!url) return;
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand(cmd, false, null);
    }
    syncHtmlEditor();
  }

  function renderOptionalFields(candidate) {
    const optional = [
      { key: "cta", label: "CTA" },
      { key: "action_line", label: "Action Line" },
      { key: "quote_text", label: "Quote Text" },
      { key: "rally_line", label: "Rally Line" },
    ];
    const html = optional
      .filter((field) => candidate[field] !== undefined)
      .map((field) => '<label>' + field.label + '</label><input id="opt_' + field.key + '" value="' + escapeAttr(safe(candidate[field])) + '" />')
      .join("\n");
    const container = $("optionalFields");
    if (container) container.innerHTML = html;
  }

  function openEditor(candidateId) {
    const c = state.candidatesById.get(candidateId);
    if (!c) return;
    state.selectedCandidateId = candidateId;
    const empty = $("editorEmpty");
    const form = $("editorForm");
    if (empty) empty.style.display = "none";
    if (form) form.style.display = "block";
    $("f_id").value = c.id;
    $("f_stage").value = safe(c.funnel_stage, "");
    $("f_subject").value = safe(c.subject, "");
    $("f_preview_text").value = safe(c.preview_text, "");
    $("f_image_url").value = safe(c.image_url, "");
    $("f_image_alt").value = candidateImageAlt(c) || imageAltFromCatalog(c.image_url);
    setHtmlEditorValue(c.body_html);
    $("f_body_text").value = safe(c.body_text || c.body_markdown, "");
    renderImageSuggestions();
    renderOptionalFields(c);
    const disabled = !!state.locked;
    ["f_subject", "f_preview_text", "f_image_url", "f_image_alt", "f_body_text", "saveBtn"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = disabled;
    });
    const editor = $("f_body_html_editor");
    if (editor) editor.contentEditable = disabled ? "false" : "true";
    document.querySelectorAll("#htmlToolbar button[data-cmd]").forEach((btn) => {
      btn.disabled = disabled;
    });
    ["cta", "action_line", "quote_text", "rally_line"].forEach((k) => {
      const el = $("opt_" + k);
      if (el) el.disabled = disabled;
    });
    const lock = $("lockState");
    if (lock) lock.textContent = disabled ? "Locked: editing disabled" : "Unlocked";
  }

  async function loadMergedPreview(candidateId) {
    if (!candidateId) return;
    try {
      const data = await fetchJson("/admin/ui_api/preview?candidate_id=" + encodeURIComponent(candidateId));
      state.lastPreviewHtml = safe(data.merged_html, "");
      state.lastPreviewText = safe(data.plain_text, "");
      $("previewFrame").srcdoc = state.lastPreviewHtml;
      setToast("Preview loaded for " + candidateId, "ok");
    } catch (err) {
      setToast(err.message, "error");
    }
  }

  async function saveCandidate(ev) {
    ev.preventDefault();
    if (!state.selectedCandidateId || state.locked) return;
    const body = {
      subject: $("f_subject").value,
      preview_text: $("f_preview_text").value,
      image_url: $("f_image_url").value || null,
      image_alt: $("f_image_alt").value || null,
      body_html: syncHtmlEditor(),
      body_text: $("f_body_text").value,
    };
    ["cta", "action_line", "quote_text", "rally_line"].forEach((k) => {
      const el = $("opt_" + k);
      if (el) body[k] = el.value;
    });
    try {
      await fetchJson("/admin/ui_api/candidates/" + encodeURIComponent(state.selectedCandidateId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setToast("Candidate saved", "ok");
      await reloadWeek(state.selectedDate || state.weekOf);
      openEditor(state.selectedCandidateId);
      await loadMergedPreview(state.selectedCandidateId);
    } catch (err) {
      setToast(err.message, "error");
    }
  }

  async function loadSendHistory(weeklyRunId) {
    const sendRowsEl = $("sendRows");
    const recipientRowsEl = $("recipientRows");
    if (recipientRowsEl) recipientRowsEl.innerHTML = "";
    if (!weeklyRunId) {
      if (sendRowsEl) sendRowsEl.innerHTML = '<tr><td colspan="8" class="muted">No weekly run yet.</td></tr>';
      state.debug.sends = { weekly_run_id: null, sends: [] };
      renderDebug();
      return;
    }
    try {
      const sendUrl = "/admin/ui_api/sends?weekly_run_id=" + encodeURIComponent(weeklyRunId);
      const data = await fetchJson(sendUrl);
      state.debug.sends = { url: sendUrl, data };
      renderDebug();
      const sends = data.sends || [];
      if (!sendRowsEl) return;
      if (!sends.length) {
        sendRowsEl.innerHTML = '<tr><td colspan="8" class="muted">No sends for this week.</td></tr>';
        return;
      }
      sendRowsEl.innerHTML = sends
        .map(
          (row) =>
            "<tr><td>" +
            escapeHtml(safe(row.id, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.created_at, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.funnel_stage, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.candidate_id, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.subject, "(missing)")) +
            "</td><td>" +
            escapeHtml(String(Number(row.sent_count || 0))) +
            "</td><td>" +
            escapeHtml(String(Number(row.failed_count || 0))) +
            '</td><td><button data-send-id="' +
            escapeAttr(safe(row.id)) +
            '">Recipients</button></td></tr>'
        )
        .join("\n");
      sendRowsEl.querySelectorAll("button[data-send-id]").forEach((btn) => {
        btn.addEventListener("click", () => loadRecipients(btn.getAttribute("data-send-id")));
      });
    } catch (err) {
      pushDebugError("loadSendHistory: " + err.message);
      renderDebug();
      setToast(err.message, "error");
      if (sendRowsEl) sendRowsEl.innerHTML = '<tr><td colspan="8" class="muted">Failed to load send history.</td></tr>';
    }
  }

  async function loadRecipients(sendId) {
    const el = $("recipientRows");
    if (!el) return;
    try {
      const data = await fetchJson("/admin/ui_api/sends/recipients?send_id=" + encodeURIComponent(sendId));
      const rows = data.recipients || [];
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="5" class="muted">No recipients found.</td></tr>';
        return;
      }
      el.innerHTML = rows
        .map(
          (row) =>
            "<tr><td>" +
            escapeHtml(safe(row.contact_name, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.recipient_email, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.status, "(missing)")) +
            "</td><td>" +
            escapeHtml(safe(row.error, "")) +
            "</td><td>" +
            escapeHtml(safe(row.created_at, "(missing)")) +
            "</td></tr>"
        )
        .join("\n");
    } catch (err) {
      setToast(err.message, "error");
      el.innerHTML = '<tr><td colspan="5" class="muted">Failed to load recipients.</td></tr>';
    }
  }

  async function reloadWeek(selectedDate) {
    const weekOf = weekOfFromDate(selectedDate);
    state.selectedDate = selectedDate;
    state.weekOf = weekOf;
    $("selectedWeekLabel").textContent = "Selected date: " + selectedDate + " (week_of: " + weekOf + ")";
    renderDebug();
    try {
      const healthUrl = "/health";
      const weeklyUrl = "/admin/weekly?week_of=" + encodeURIComponent(weekOf);
      const candidatesUrl = "/admin/candidates?week_of=" + encodeURIComponent(weekOf);
      const imagesUrl = "/admin/email_images?limit=500";
      try {
        const health = await fetchJson(healthUrl);
        state.debug.connection = "ok " + healthUrl + " => " + stringifyDebug(health);
      } catch (healthErr) {
        state.debug.connection = "failed " + healthUrl + " => " + healthErr.message;
        pushDebugError("health check: " + healthErr.message);
      }
      renderDebug();
      const [weekly, candidates, images] = await Promise.all([
        fetchJson(weeklyUrl),
        fetchJson(candidatesUrl),
        fetchJson(imagesUrl),
      ]);
      state.run = weekly.weekly_run || null;
      state.candidates = candidates.candidates || [];
      state.images = images.rows || [];
      state.locked = !!(state.run && state.run.locked_at);
      state.candidatesById = new Map(state.candidates.map((c) => [c.id, c]));
      renderImageSuggestions();
      state.debug.weekly = { url: weeklyUrl, data: weekly };
      state.debug.candidates = { url: candidatesUrl, data: candidates };
      state.debug.images = { url: imagesUrl, data: { count: images.count, sample: (images.rows || []).slice(0, 5) } };
      renderCards();
      await loadSendHistory(state.run ? state.run.id : null);
      renderDebug();
      if (state.selectedCandidateId && state.candidatesById.has(state.selectedCandidateId)) {
        openEditor(state.selectedCandidateId);
      } else {
        const empty = $("editorEmpty");
        const form = $("editorForm");
        if (empty) empty.style.display = "block";
        if (form) form.style.display = "none";
      }
      setToast("Loaded", "ok");
    } catch (err) {
      pushDebugError("reloadWeek: " + err.message);
      renderDebug();
      setToast(err.message, "error");
    }
  }

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value || "");
      setToast(label + " copied", "ok");
    } catch (err) {
      setToast("Copy failed: " + err.message, "error");
    }
  }

  try {
    const weekInput = $("weekInput");
    if (!weekInput) throw new Error("weekInput missing");
    weekInput.value = toYmdToday();
    $("reloadBtn").addEventListener("click", () => reloadWeek(weekInput.value));
    weekInput.addEventListener("change", () => reloadWeek(weekInput.value));
    $("editorForm").addEventListener("submit", saveCandidate);
    $("f_image_url").addEventListener("change", maybeFillImageAltFromCatalog);
    $("f_body_html_editor").addEventListener("input", syncHtmlEditor);
    document.querySelectorAll("#htmlToolbar button[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => applyHtmlCommand(btn.getAttribute("data-cmd")));
    });
    $("previewBtn").addEventListener("click", () => loadMergedPreview(state.selectedCandidateId));
    $("copyHtmlBtn").addEventListener("click", () => copyText(state.lastPreviewHtml, "Merged HTML"));
    $("copyTextBtn").addEventListener("click", () => copyText(state.lastPreviewText, "Plain text"));
    reloadWeek(weekInput.value);
  } catch (err) {
    bootDebug("[bootstrap] " + (err?.message || String(err)));
  }
}
