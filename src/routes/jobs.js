import { json, normalizePath, nowIso } from "../lib/utils.js";
import { generateCandidatesForWeek } from "./candidates.js";

// GET /jobs/tick
export async function handleJobs(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/jobs/tick" && (method === "GET" || method === "POST")) {
    return tick(env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function tick(env) {
  const now = new Date();
  const nowZ = nowIso(); // for storage (ISO)
  const config = await loadConfig(env);

  const week_of = getWeekOfChicago(now, config.timezone);

  // ensure weekly run exists
  const run = await ensureWeeklyRun(env, week_of);

  const actions = [];

  const chicago = getChicagoParts(now, config.timezone);
  const dow = chicago.dow;          // e.g. "TUESDAY"
  const hhmm = chicago.hhmm;        // e.g. "09:45"

  // 1) Generate stage
  if (dow === config.generate.dow && hhmm === config.generate.time) {
    // only generate if not already generated and candidates don’t exist
    const res = await generateCandidatesForWeek(env, week_of, { force: false });
    if (!res.skipped) actions.push("generate");
  }

  // Refresh run after possible generate
  const run2 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  // 2) Lock stage
  if (dow === config.lock.dow && hhmm === config.lock.time) {
    const didLock = await lockWeeklyRun(env, run2, nowZ);
    if (didLock) actions.push("lock");
  }

  // 3) Send stage (STUB)
  // Marks sent_at/status but does NOT email yet.
  const run3 = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`).bind(week_of).first();

  if (dow === config.send.dow && hhmm === config.send.time) {
    const didSend = await sendStub(env, run3, nowZ);
    if (didSend) actions.push("send_stub");
  }

  return json({
    status: "ok",
    now: now.toISOString(),
    week_of,
    actions,
    config
  });
}

async function loadConfig(env) {
  const defaults = {
    timezone: "America/Chicago",
    generate: { dow: "FRIDAY", time: "09:00" },
    lock: { dow: "TUESDAY", time: "09:45" },
    send: { dow: "TUESDAY", time: "10:00" }
  };

  // config table: key/value_json/updated_at
  const row = await env.DB.prepare(`SELECT value_json FROM config WHERE key = 'app' LIMIT 1`).first();

  if (!row?.value_json) return defaults;

  try {
    const parsed = JSON.parse(row.value_json);
    return {
      timezone: parsed.timezone || defaults.timezone,
      generate: parsed.generate || defaults.generate,
      lock: parsed.lock || defaults.lock,
      send: parsed.send || defaults.send
    };
  } catch {
    return defaults;
  }
}

async function ensureWeeklyRun(env, week_of) {
  let run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  if (run) return run;

  const id = crypto.randomUUID();
  const now = nowIso();

  await env.DB.prepare(`
    INSERT INTO weekly_runs (id, week_of, status, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(id, week_of, now, now).run();

  run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
  return run;
}

async function lockWeeklyRun(env, run, nowZ) {
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

async function sendStub(env, run, nowZ) {
  // Don’t send twice
  if (run.sent_at) return false;

  // If not locked yet, lock it right now (enforces “auto-authorized”)
  if (!run.locked_at) {
    await lockWeeklyRun(env, run, nowZ);
    run = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE id = ?`).bind(run.id).first();
  }

  await env.DB.prepare(`
    UPDATE weekly_runs
    SET sent_at = ?, status = 'sent_stub', updated_at = ?
    WHERE id = ?
  `).bind(nowZ, nowZ, run.id).run();

  return true;
}

// --- Chicago helpers ---
// week_of = Monday date string in America/Chicago
function getWeekOfChicago(now, tz) {
  const parts = getChicagoParts(now, tz);

  // Build a Date for Chicago local day (approx) by interpreting components as UTC,
  // then do day math. Good enough for week bucket.
  const chicagoDate = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  const dowIdx = chicagoDate.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = (dowIdx + 6) % 7;  // Sun->6, Mon->0, Tue->1...
  chicagoDate.setUTCDate(chicagoDate.getUTCDate() - mondayOffset);

  const yyyy = chicagoDate.getUTCFullYear();
  const mm = String(chicagoDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(chicagoDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getChicagoParts(now, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const dow = parts.weekday.toUpperCase(); // "TUESDAY"
  const hhmm = `${parts.hour}:${parts.minute}`;

  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    dow,
    hhmm
  };
}