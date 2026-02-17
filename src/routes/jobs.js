import { json, nowIso, normalizePath } from "../lib/utils.js";

export async function handleJobs(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  // Allow manual calling locally via GET for convenience
  if (path === "/jobs/tick" && (method === "POST" || method === "GET")) {
    return tick(env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function tick(env) {
  const cfg = await getConfig(env);

  const now = new Date();
  const nowLabel = now.toISOString();

  const week_of = getWeekKeyChicago(now); // Monday date string
  const run = await upsertWeeklyRun(env, week_of);

  // Decide whether each stage should run “now”
  const shouldGenerate = isWindowNowChicago(now, cfg.generate);
  const shouldLock     = isWindowNowChicago(now, cfg.lock);
  const shouldSend     = isWindowNowChicago(now, cfg.send);

  const actions = [];

  // Generate stage
  if (shouldGenerate && !run.generated_at) {
    await setWeeklyStage(env, week_of, "generated_at", nowLabel);
    actions.push("generate");
    // TODO later: generate candidates
  }

  // Lock stage
  if (shouldLock && !run.locked_at) {
    await setWeeklyStage(env, week_of, "locked_at", nowLabel);
    actions.push("lock");
    // TODO later: lock candidate selection
  }

  // Send stage
  if (shouldSend && !run.sent_at) {
    await setWeeklyStage(env, week_of, "sent_at", nowLabel);
    actions.push("send");
    // TODO later: send emails
  }

  return json({
    status: "ok",
    now: nowLabel,
    week_of,
    actions,
    config: cfg
  });
}

async function getConfig(env) {
  const row = await env.DB.prepare(`SELECT value_json FROM config WHERE key = ?`)
    .bind("app")
    .first();

  if (!row) {
    return {
      timezone: "America/Chicago",
      generate: { dow: "FRIDAY", time: "09:00" },
      lock: { dow: "TUESDAY", time: "09:45" },
      send: { dow: "TUESDAY", time: "10:00" }
    };
  }
  return JSON.parse(row.value_json);
}

async function upsertWeeklyRun(env, week_of) {
  const existing = await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();

  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = nowIso();

  await env.DB.prepare(`
    INSERT INTO weekly_runs (id, week_of, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).bind(id, week_of, now, now).run();

  return await env.DB.prepare(`SELECT * FROM weekly_runs WHERE week_of = ?`)
    .bind(week_of)
    .first();
}

async function setWeeklyStage(env, week_of, col, value) {
  const now = nowIso();
  const sql = `
    UPDATE weekly_runs
    SET ${col} = ?, updated_at = ?
    WHERE week_of = ?
  `;
  await env.DB.prepare(sql).bind(value, now, week_of).run();
}

/**
 * “Is it time to run this stage now?”
 * Window logic: run if current local day matches and current HH:MM matches exactly.
 * Since cron ticks every 5 minutes, this will still hit.
 */
function isWindowNowChicago(nowUtc, stage) {
  const chicago = toChicago(nowUtc);
  const dow = dayOfWeek(chicago); // MONDAY..SUNDAY
  const hhmm = `${pad2(chicago.getHours())}:${pad2(chicago.getMinutes())}`;
  return (dow === String(stage.dow || "").toUpperCase()) && (hhmm === stage.time);
}

function getWeekKeyChicago(nowUtc) {
  const d = toChicago(nowUtc);
  // Monday-start week. Convert JS Sunday=0..Saturday=6 into Monday=0..Sunday=6.
  const js = d.getDay();
  const mondayOffset = (js + 6) % 7; // Mon->0, Tue->1,... Sun->6
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);
  return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
}

/**
 * Cheap timezone conversion without libraries:
 * Use Intl to format in America/Chicago, then rebuild a Date from parts.
 * Good enough for scheduler logic.
 */
function toChicago(nowUtc) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(fmt.formatToParts(nowUtc).map(p => [p.type, p.value]));
  // Build as if local Chicago time in UTC container
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
}

function dayOfWeek(d) {
  const map = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  return map[d.getDay()];
}

function pad2(n) { return String(n).padStart(2, "0"); }