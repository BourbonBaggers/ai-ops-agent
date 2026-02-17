import { json, nowIso, clampInt, normalizePath, strOrNull, str } from "../lib/utils.js";

export async function handlePolicy(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/policy" && method === "GET") {
    return getActivePolicy(env);
  }

  if (path === "/admin/policy" && method === "POST") {
    return createPolicyVersion(request, env);
  }

  if (path === "/admin/policy/history" && method === "GET") {
    return getPolicyHistory(url, env);
  }

    // POST /admin/policy/load (raw markdown body)
    if (path === "/admin/policy/load" && method === "POST") {
    return loadPolicyMarkdown(request, env);
    }

    // GET /admin/policy/raw (returns active markdown)
    if (path === "/admin/policy/raw" && method === "GET") {
    return getActivePolicyRaw(env);
    }

  return json({ status: "error", message: "Not found" }, 404);
}

async function getActivePolicy(env) {
  const row = await env.DB.prepare(`
    SELECT id, title, body_markdown, is_active, created_at
    FROM policy_versions
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).first();

  if (!row) return json({ status: "ok", policy: null });

  return json({ status: "ok", policy: row });
}

async function createPolicyVersion(request, env) {
  // Accept JSON: { title, body_markdown }
  const body = await request.json();

  const title = strOrNull(body.title) || "Marketing Standards Policy";
  const body_markdown = strOrNull(body.body_markdown);

  if (!body_markdown) {
    return json({ status: "error", message: "body_markdown is required" }, 400);
  }

  const id = crypto.randomUUID();
  const created_at = nowIso();

  // Make new active, deactivate previous (atomic via batch)
  const stmts = [
    env.DB.prepare(`UPDATE policy_versions SET is_active = 0 WHERE is_active = 1`),
    env.DB.prepare(`
      INSERT INTO policy_versions (id, is_active, title, body_markdown, created_at)
      VALUES (?, 1, ?, ?, ?)
    `).bind(id, title, body_markdown, created_at)
  ];

  await env.DB.batch(stmts);

  return json({ status: "ok", id, title, created_at });
}

async function getPolicyHistory(url, env) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 20);

  const res = await env.DB.prepare(`
    SELECT id, title, is_active, created_at
    FROM policy_versions
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return json({ status: "ok", count: res.results.length, history: res.results });
}

async function loadPolicyMarkdown(request, env) {
  const ct = request.headers.get("content-type") || "";
  if (!(ct.includes("text/markdown") || ct.includes("text/plain") || ct.includes("application/octet-stream"))) {
    // don’t be strict; Postman sometimes sends weird types
  }

  const body_markdown = (await request.text()).trim();
  if (!body_markdown) return json({ status: "error", message: "Empty body" }, 400);

  const title = extractTitleFromMarkdown(body_markdown) || "Marketing Standards Policy";
  const id = crypto.randomUUID();
  const created_at = nowIso();

  await env.DB.batch([
    env.DB.prepare(`UPDATE policy_versions SET is_active = 0 WHERE is_active = 1`),
    env.DB.prepare(`
      INSERT INTO policy_versions (id, is_active, title, body_markdown, created_at)
      VALUES (?, 1, ?, ?, ?)
    `).bind(id, title, body_markdown, created_at)
  ]);

  return json({ status: "ok", id, title, created_at });
}

async function getActivePolicyRaw(env) {
  const row = await env.DB.prepare(`
    SELECT body_markdown
    FROM policy_versions
    WHERE is_active = 1
    ORDER BY created_at DESC
    LIMIT 1
  `).first();

  if (!row) return new Response("", { status: 404 });

  return new Response(row.body_markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8" }
  });
}

function extractTitleFromMarkdown(md) {
  // First line like: "# Title"
  const first = md.split("\n")[0] || "";
  const m = first.match(/^#\s+(.+)\s*$/);
  return m ? m[1].trim() : "";
}