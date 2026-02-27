import { json, normalizePath, clampInt } from "../lib/utils.js";
import { parseCsv } from "../lib/csv.js";

export async function handleEmailImages(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/email_images" && method === "GET") {
    return listEmailImages(url, env);
  }

  if (path === "/admin/email_images/upload" && method === "POST") {
    return uploadEmailImages(request, env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function listEmailImages(url, env) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);
  const productName = clean(url.searchParams.get("product_name"));

  const sql = `
    SELECT id, url, alt, description, product_name, created_at, updated_at
    FROM email_images
    ${productName ? "WHERE product_name = ?" : ""}
    ORDER BY COALESCE(product_name, ''), url
    LIMIT ?
  `;
  const stmt = env.DB.prepare(sql);
  const rows = productName
    ? await stmt.bind(productName, limit).all()
    : await stmt.bind(limit).all();

  return json({
    status: "ok",
    count: rows.results.length,
    rows: rows.results,
  });
}

async function uploadEmailImages(request, env) {
  const csvText = await readCsvRequestBody(request);
  if (!csvText) {
    return json({ status: "error", rows_inserted: 0, errors: ["Missing CSV body"] }, 400);
  }

  const parsedRows = parseCsv(csvText);
  if (!parsedRows.length) {
    return json({ status: "error", rows_inserted: 0, errors: ["CSV has no data rows"] }, 400);
  }

  const errors = [];
  const rows = [];
  const seen = new Set();

  for (let i = 0; i < parsedRows.length; i++) {
    const raw = parsedRows[i];
    const url = pick(raw, ["url"]);
    const alt = pick(raw, ["alt"]);
    const description = pick(raw, ["description"]);
    const product_name = nullable(pick(raw, ["product_name", "productName"]));

    if (!url) errors.push(`row ${i + 2}: url is required`);
    if (!alt) errors.push(`row ${i + 2}: alt is required`);
    if (!description) errors.push(`row ${i + 2}: description is required`);
    if (url && !/^https?:\/\//i.test(url)) {
      errors.push(`row ${i + 2}: url must start with http:// or https://`);
    }
    if (url && seen.has(url)) {
      errors.push(`row ${i + 2}: duplicate url in CSV`);
    }
    if (url) seen.add(url);

    rows.push({ url, alt, description, product_name });
  }

  if (errors.length) {
    return json({ status: "error", rows_inserted: 0, errors }, 400);
  }

  const stmts = [
    env.DB.prepare("DELETE FROM email_images"),
    ...rows.map((row) =>
      env.DB.prepare(
        `INSERT INTO email_images (url, alt, description, product_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(row.url, row.alt, row.description, row.product_name)
    ),
  ];

  try {
    await env.DB.batch(stmts);
  } catch (err) {
    return json(
      { status: "error", rows_inserted: 0, errors: [err?.message || "Upload failed"] },
      400
    );
  }

  return json({ status: "ok", rows_inserted: rows.length, errors: [] });
}

async function readCsvRequestBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("text/csv")) {
    return (await request.text()).trim();
  }

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return "";
    return (await file.text()).trim();
  }

  return (await request.text()).trim();
}

function pick(row, keys) {
  const entries = Object.entries(row || {});
  for (const key of keys) {
    const found = entries.find(([k]) => k.trim().toLowerCase() === key.toLowerCase());
    if (found) return clean(found[1]);
  }
  return "";
}

function clean(v) {
  return String(v ?? "").trim();
}

function nullable(v) {
  const s = clean(v);
  return s || null;
}
