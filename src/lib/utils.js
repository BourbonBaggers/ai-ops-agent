export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export function nowIso() {
  return new Date().toISOString();
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
  const s = (p || "/").replace(/\/+$/, "");
  return s === "" ? "/" : s;
}