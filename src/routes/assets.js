// src/routes/assets.js — read-only listing of valid image assets from R2
import { json } from "../lib/utils.js";

const ALLOWED_PREFIX = "Product Pictures/Sized for Websites/";
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function extOf(key) {
  const dot = key.lastIndexOf(".");
  return dot >= 0 ? key.slice(dot).toLowerCase() : "";
}

// Returns the product name (first path segment after the prefix), or null if
// the key has no product subdirectory (i.e. sits directly at the prefix root).
function productNameOf(key) {
  const relative = key.slice(ALLOWED_PREFIX.length);
  const slash = relative.indexOf("/");
  // Require at least one character before AND after the slash so we skip
  // bare directory markers ("Widget A/") and root-level files.
  return slash > 0 && slash < relative.length - 1 ? relative.slice(0, slash) : null;
}

function isValidImageKey(key) {
  if (!key.startsWith(ALLOWED_PREFIX)) return false;
  if (!ALLOWED_EXTS.has(extOf(key))) return false;
  return productNameOf(key) !== null;
}

export async function handleAssets(request, env) {
  const url = new URL(request.url);
  const debug = url.searchParams.get("debug") === "1";

  const dbg = { status: debug ? "debug" : "ok", steps: [] };
  const log = (step, data = {}) => {
    const entry = { step, ...data };
    dbg.steps.push(entry);
    if (debug) console.log("[assets]", JSON.stringify(entry));
  };

  if (request.method !== "GET") {
    return json({ status: "error", message: "Method not allowed" }, 405);
  }

  log("env_presence", {
    has_ASSETS_R2: !!env.ASSETS_R2,
    has_ASSET_BASE_URL: !!env.ASSET_BASE_URL,
    ASSET_BASE_URL: env.ASSET_BASE_URL ? "(set)" : "(missing)",
  });

  if (!env.ASSETS_R2) return json({ status: "error", message: "ASSETS_R2 binding not configured" }, 503);
  if (!env.ASSET_BASE_URL) return json({ status: "error", message: "ASSET_BASE_URL env var not set" }, 503);

  const baseUrl = env.ASSET_BASE_URL.endsWith("/") ? env.ASSET_BASE_URL : env.ASSET_BASE_URL + "/";
  log("baseUrl", { baseUrl });

  // IMPORTANT: show prefix
  const prefixRaw = ALLOWED_PREFIX;
  const prefix = normalizePrefix(prefixRaw); // you can implement normalizePrefix() or inline it
  log("prefix", { prefixRaw, prefix });

  // Root list (no prefix) sanity check
  const root = await env.ASSETS_R2.list({ limit: 10 });
  log("r2_root_list", {
    objectsCount: root.objects?.length ?? 0,
    sampleKeys: (root.objects ?? []).slice(0, 10).map(o => o.key),
    truncated: !!root.truncated,
    delimitedPrefixes: root.delimitedPrefixes ?? [],
  });

  // Prefix list sanity check
  const pref = await env.ASSETS_R2.list({ prefix, limit: 10 });
  log("r2_prefix_list", {
    objectsCount: pref.objects?.length ?? 0,
    sampleKeys: (pref.objects ?? []).slice(0, 10).map(o => o.key),
    truncated: !!pref.truncated,
    delimitedPrefixes: pref.delimitedPrefixes ?? [],
  });

  // Full pagination under prefix
  const validObjects = [];
  let cursor;

  do {
    const page = await env.ASSETS_R2.list({ prefix, ...(cursor ? { cursor } : {}) });
    log("r2_page", {
      cursor_in: cursor ?? null,
      returned: page.objects?.length ?? 0,
      truncated: !!page.truncated,
      cursor_out: page.cursor ?? null,
    });

    for (const obj of page.objects ?? []) {
      if (isValidImageKey(obj.key)) validObjects.push(obj);
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  validObjects.sort((a, b) => a.key.localeCompare(b.key));

  const grouped = {};
  const flat = [];

  for (const obj of validObjects) {
    const productName = productNameOf(obj.key);
    const urlOut = baseUrl + encodeURI(obj.key);
    const item = { key: obj.key, url: urlOut };

    if (!grouped[productName]) grouped[productName] = [];
    grouped[productName].push(item);
    flat.push({ productName, key: obj.key, url: urlOut });
  }

  log("final", {
    count: flat.length,
    firstUrls: flat.slice(0, 5),
  });

  if (debug) {
    return json({
      ...dbg,
      allowedPrefixRaw: prefixRaw,
      allowedPrefixNormalized: prefix,
      rootSample: (root.objects ?? []).slice(0, 10).map(o => o.key),
      prefixSample: (pref.objects ?? []).slice(0, 10).map(o => o.key),
      count: flat.length,
      flat: flat.slice(0, 25), // don’t dump 8GB worth of keys accidentally
      groupedKeys: Object.keys(grouped),
    });
  }

  return json({ status: "ok", count: flat.length, grouped, flat });
}

function normalizePrefix(p) {
  if (!p) return "";
  // R2 keys are literal. Do NOT URL-encode the prefix.
  // Ensure it ends with a slash if you mean “folder”.
  return p.endsWith("/") ? p : p + "/";
}