import { json, nowIso, normalizePath } from "../lib/utils.js";

const DEFAULT_CONFIG = {
  timezone: "America/Chicago",

  generate: { dow: "FRIDAY", time: "09:00" },
  lock:     { dow: "TUESDAY", time: "09:45" },
  send:     { dow: "TUESDAY", time: "10:00" },

  // Future knobs
  dry_run: false
};

export async function handleConfig(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/config" && method === "GET") {
    const cfg = await getConfig(env);
    return json({ status: "ok", config: cfg });
  }

  if (path === "/admin/config" && method === "POST") {
    const patch = await request.json();
    const cfg = await getConfig(env);

    // shallow merge at top level + known nested objects
    const merged = {
      ...cfg,
      ...patch,
      generate: { ...(cfg.generate || {}), ...(patch.generate || {}) },
      lock:     { ...(cfg.lock || {}), ...(patch.lock || {}) },
      send:     { ...(cfg.send || {}), ...(patch.send || {}) },
    };

    await setConfig(env, merged);
    return json({ status: "ok", config: merged });
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function getConfig(env) {
  const row = await env.DB.prepare(`SELECT value_json FROM config WHERE key = ?`)
    .bind("app")
    .first();

  if (!row) return DEFAULT_CONFIG;

  try {
    const parsed = JSON.parse(row.value_json);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      generate: { ...DEFAULT_CONFIG.generate, ...(parsed.generate || {}) },
      lock:     { ...DEFAULT_CONFIG.lock, ...(parsed.lock || {}) },
      send:     { ...DEFAULT_CONFIG.send, ...(parsed.send || {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function setConfig(env, cfg) {
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO config (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).bind("app", JSON.stringify(cfg), now).run();
}