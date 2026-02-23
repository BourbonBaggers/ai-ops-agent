// src/routes/assets.js — read-only listing of valid image assets from R2
import { json } from "../lib/utils.js";

const ALLOWED_PREFIX = "assets/Product Pictures/Sized for Websites/";
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
  if (request.method !== "GET") {
    return json({ status: "error", message: "Method not allowed" }, 405);
  }

  if (!env.ASSETS_R2) {
    return json({ status: "error", message: "ASSETS_R2 binding not configured" }, 503);
  }

  if (!env.ASSET_BASE_URL) {
    return json({ status: "error", message: "ASSET_BASE_URL env var not set" }, 503);
  }

  // Normalise: ensure exactly one trailing slash so concatenation is unambiguous.
  const baseUrl = env.ASSET_BASE_URL.endsWith("/")
    ? env.ASSET_BASE_URL
    : env.ASSET_BASE_URL + "/";

  // Page through all R2 objects under the allowed prefix.
  // R2 list() returns at most 1 000 objects per call; cursor pagination covers larger buckets.
  const validObjects = [];
  let cursor;
  do {
    const page = await env.ASSETS_R2.list({
      prefix: ALLOWED_PREFIX,
      ...(cursor ? { cursor } : {}),
    });

    for (const obj of page.objects ?? []) {
      if (isValidImageKey(obj.key)) {
        validObjects.push(obj);
      }
    }

    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  // Sort keys for stable, deterministic output regardless of R2 traversal order.
  validObjects.sort((a, b) => a.key.localeCompare(b.key));

  // Build grouped and flat outputs.
  const grouped = {};
  const flat = [];

  for (const obj of validObjects) {
    const productName = productNameOf(obj.key);
    // url spec: ASSET_BASE_URL + encodeURI(key)
    // encodeURI preserves "/" so path structure is intact; spaces become %20.
    const url = baseUrl + encodeURI(obj.key);
    const item = { key: obj.key, url };

    if (!grouped[productName]) grouped[productName] = [];
    grouped[productName].push(item);

    flat.push({ productName, key: obj.key, url });
  }

  return json({
    status: "ok",
    count: flat.length,
    grouped,
    flat,
  });
}
