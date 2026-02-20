export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export function str(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export function strOrNull(v) {
  const s = str(v);
  return s.length ? s : null;
}

export function normalizeEmail(e) {
  const s = str(e).toLowerCase();
  return s.includes("@") ? s : "";
}

export function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

export function normalizePath(p) {
  if (!p) return "/";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

export async function readJsonBody(request) {
  // Returns parsed object, or null if body missing/invalid
  const text = await request.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

export async function requireJsonBody(request) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw badRequest("Expected application/json body");
  }

  // Use text() so empty body is detectable (request.json() throws a generic SyntaxError)
  const raw = await request.text();
  if (!raw || !raw.trim()) {
    throw badRequest("Missing JSON body");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest("Invalid JSON body");
  }
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function safeJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}
