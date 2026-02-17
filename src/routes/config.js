import { json, normalizePath, nowIso } from "../lib/utils.js";

// GET  /admin/config
// POST /admin/config  (JSON merge patch)

export async function handleConfig(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/config" && method === "GET") {
    const cfg = await getConfig(env);
    return json({ status: "ok", config: cfg });
  }

  if (path === "/admin/config" && method === "POST") {
    const patch = await request.json().catch(() => null);
    if (!patch || typeof patch !== "object") {
      return json({ status: "error", message: "Invalid JSON body" }, 400);
    }

    // Load current, merge, validate, save
    const current = await getConfig(env);
    const merged = deepMerge(structuredClone(current), patch);

    const errors = validateConfig(merged);
    if (errors.length) {
      return json({ status: "error", message: "Config validation failed", errors }, 400);
    }

    await putConfig(env, merged);

    return json({ status: "ok", config: merged });
  }

  // Optional helper: set generate/lock/send to "now" so tick fires immediately.
  // POST /admin/config/override-now?mode=generate|lock|send|all
  if (path === "/admin/config/override-now" && method === "POST") {
    const mode = (url.searchParams.get("mode") || "all").toLowerCase();
    const current = await getConfig(env);

    const tz = current.timezone || "America/Chicago";
    const now = new Date();
    const { dow, hhmm } = chicagoParts(now, tz);

    if (mode === "generate" || mode === "all") current.generate = { dow, time: hhmm };
    if (mode === "lock" || mode === "all") current.lock = { dow, time: hhmm };
    if (mode === "send" || mode === "all") current.send = { dow, time: hhmm };

    await putConfig(env, current);

    return json({
      status: "ok",
      note: "Updated schedule to current Chicago minute. Hit /jobs/tick to trigger.",
      now: now.toISOString(),
      effective: { dow, time: hhmm },
      config: current
    });
  }

  return json({ status: "error", message: "Not found" }, 404);
}

// --- Config storage in D1: table config(key,value_json,updated_at) ---

async function getConfig(env) {
  const defaults = {
    timezone: "America/Chicago",
    generate: { dow: "FRIDAY", time: "09:00" },
    lock: { dow: "TUESDAY", time: "09:45" },
    send: { dow: "TUESDAY", time: "10:00" }
  };

  const row = await env.DB.prepare(
    `SELECT value_json FROM config WHERE key = 'app' LIMIT 1`
  ).first();

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

async function putConfig(env, cfg) {
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO config (key, value_json, updated_at)
    VALUES ('app', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).bind(JSON.stringify(cfg), now).run();
}

// --- Validation ---

function validateConfig(cfg) {
  const errors = [];

  if (!cfg || typeof cfg !== "object") {
    errors.push("config must be an object");
    return errors;
  }

  if (!cfg.timezone || typeof cfg.timezone !== "string") {
    errors.push("timezone must be a string (e.g., America/Chicago)");
  }

  for (const key of ["generate", "lock", "send"]) {
    const block = cfg[key];
    if (!block || typeof block !== "object") {
      errors.push(`${key} must be an object`);
      continue;
    }

    if (!isValidDOW(block.dow)) errors.push(`${key}.dow must be one of: ${validDows().join(", ")}`);
    if (!isValidTime(block.time)) errors.push(`${key}.time must be HH:MM (24h)`);
  }

  return errors;
}

function validDows() {
  return ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
}

function isValidDOW(s) {
  return typeof s === "string" && validDows().includes(s.toUpperCase());
}

function isValidTime(s) {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// --- Merge helper ---

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// --- Chicago time helper ---

function chicagoParts(now, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  return {
    dow: parts.weekday.toUpperCase(),
    hhmm: `${parts.hour}:${parts.minute}`
  };
}