// tests/_helpers.mjs
import assert from "node:assert/strict";

export const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:8787";

/**
 * Fetch wrapper that:
 * - asserts status
 * - tries to parse JSON
 * - includes better errors when things go sideways
 */
export async function fetchJson(path, { method = "GET", body, headers } = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const init = {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(url, init);
  const text = await res.text();

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // leave json undefined if not JSON
  }

  return { res, text, json, url };
}

export function assertStatus({ res, text, url }, expectedStatus) {
  assert.equal(
    res.status,
    expectedStatus,
    `expected HTTP ${expectedStatus} from ${url}, got ${res.status}. body=${text}`
  );
}

export function assertJsonBody({ res, text, json, url }) {
  assert.ok(
    res.headers.get("content-type")?.includes("application/json"),
    `expected JSON content-type from ${url}. content-type=${res.headers.get("content-type")} body=${text}`
  );
  assert.ok(json && typeof json === "object", `expected JSON body from ${url}. body=${text}`);
  return json;
}

export async function getJson(path) {
  const r = await fetchJson(path);
  assertStatus(r, 200);
  return assertJsonBody(r);
}

export async function postJson(path, body) {
  const r = await fetchJson(path, { method: "POST", body });
  assertStatus(r, 200);
  return assertJsonBody(r);
}

/**
 * Convenience for endpoints that accept query strings.
 */
export function qs(params = {}) {
  const u = new URL("http://x");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }
  const s = u.searchParams.toString();
  return s ? `?${s}` : "";
}