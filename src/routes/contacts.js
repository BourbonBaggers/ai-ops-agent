import { json, nowIso, normalizeEmail, strOrNull, clampInt, normalizePath } from "../lib/utils.js";
import { parseCsv, mapContactRow, csvEscape } from "../lib/csv.js";

export async function handleContacts(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  // GET /admin/contacts?status=active&limit=200&offset=0
  if (path === "/admin/contacts" && method === "GET") {
    return listContacts(url, env);
  }

  // POST /admin/contacts
  if (path === "/admin/contacts" && method === "POST") {
    return createContact(request, env);
  }

  // POST /admin/contacts/import (multipart form-data file=@csv)
  if (path === "/admin/contacts/import" && method === "POST") {
    return importContacts(request, env);
  }

  // GET /admin/contacts/export
  if (path === "/admin/contacts/export" && method === "GET") {
    return exportContacts(env);
  }

  // PUT /admin/contacts/:id
  if (method === "PUT" && path.startsWith("/admin/contacts/")) {
    const id = path.split("/").pop();
    return updateContact(id, request, env);
  }

  return json({ status: "error", message: "Not found" }, 404);
}

async function listContacts(url, env) {
  const status = (url.searchParams.get("status") || "").trim().toLowerCase();
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 100000, 0);

  const where = status ? "WHERE status = ?" : "";
  const stmt = env.DB.prepare(`
    SELECT id, external_id, firstname, lastname, email, phone,
           address_line1, address_line2, city, state, zip,
           contact_group, status, created_at, updated_at
    FROM contacts
    ${where}
    ORDER BY COALESCE(lastname,''), COALESCE(firstname,''), email
    LIMIT ? OFFSET ?
  `);

  const res = status
    ? await stmt.bind(status, limit, offset).all()
    : await stmt.bind(limit, offset).all();

  return json({
    status: "ok",
    count: res.results.length,
    limit,
    offset,
    contacts: res.results
  });
}

async function createContact(request, env) {
  const body = await request.json();
  const email = normalizeEmail(body.email);
  if (!email) return json({ status: "error", message: "email is required" }, 400);

  const id = crypto.randomUUID();
  const now = nowIso();

  await env.DB.prepare(`
    INSERT INTO contacts (
      id, external_id, firstname, lastname, email, phone,
      address_line1, address_line2, city, state, zip,
      contact_group, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    strOrNull(body.external_id),
    strOrNull(body.firstname),
    strOrNull(body.lastname),
    email,
    strOrNull(body.phone),
    strOrNull(body.address_line1),
    strOrNull(body.address_line2),
    strOrNull(body.city),
    strOrNull(body.state),
    strOrNull(body.zip),
    strOrNull(body.contact_group),
    (String(body.status || "active").toLowerCase()),
    now,
    now
  ).run();

  return json({ status: "ok", id });
}

async function updateContact(id, request, env) {
  if (!id) return json({ status: "error", message: "missing id" }, 400);

  const exists = await env.DB.prepare(`SELECT id FROM contacts WHERE id = ?`).bind(id).first();
  if (!exists) return json({ status: "error", message: "not found" }, 404);

  const body = await request.json();
  const now = nowIso();

  const email = body.email !== undefined ? normalizeEmail(body.email) : null;
  if (body.email !== undefined && !email) {
    return json({ status: "error", message: "invalid email" }, 400);
  }

  await env.DB.prepare(`
    UPDATE contacts SET
      external_id   = COALESCE(?, external_id),
      firstname     = COALESCE(?, firstname),
      lastname      = COALESCE(?, lastname),
      email         = COALESCE(?, email),
      phone         = COALESCE(?, phone),
      address_line1 = COALESCE(?, address_line1),
      address_line2 = COALESCE(?, address_line2),
      city          = COALESCE(?, city),
      state         = COALESCE(?, state),
      zip           = COALESCE(?, zip),
      contact_group = COALESCE(?, contact_group),
      status        = COALESCE(?, status),
      updated_at    = ?
    WHERE id = ?
  `).bind(
    body.external_id !== undefined ? strOrNull(body.external_id) : null,
    body.firstname   !== undefined ? strOrNull(body.firstname)   : null,
    body.lastname    !== undefined ? strOrNull(body.lastname)    : null,
    email,
    body.phone       !== undefined ? strOrNull(body.phone)       : null,
    body.address_line1 !== undefined ? strOrNull(body.address_line1) : null,
    body.address_line2 !== undefined ? strOrNull(body.address_line2) : null,
    body.city        !== undefined ? strOrNull(body.city)        : null,
    body.state       !== undefined ? strOrNull(body.state)       : null,
    body.zip         !== undefined ? strOrNull(body.zip)         : null,
    body.contact_group !== undefined ? strOrNull(body.contact_group) : null,
    body.status      !== undefined ? String(body.status).toLowerCase() : null,
    now,
    id
  ).run();

  return json({ status: "ok", id });
}

async function importContacts(request, env) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json({ status: "error", message: "Expected multipart/form-data with field 'file'." }, 400);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return json({ status: "error", message: "Missing file. Add form-data field named 'file'." }, 400);
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length === 0) return json({ status: "error", message: "CSV has no data rows." }, 400);

  const mapped = rows.map(mapContactRow);

  // Batch UPSERTs = atomic all-or-nothing
  const now = nowIso();
  const stmts = [];
  let processed = 0;
  let skipped = 0;

  for (const c of mapped) {
    const email = normalizeEmail(c.email);
    if (!email) { skipped++; continue; }
    processed++;

    stmts.push(
      env.DB.prepare(`
        INSERT INTO contacts (
          id, external_id, firstname, lastname, email, phone,
          address_line1, address_line2, city, state, zip,
          contact_group, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          external_id   = COALESCE(excluded.external_id, contacts.external_id),
          firstname     = COALESCE(excluded.firstname, contacts.firstname),
          lastname      = COALESCE(excluded.lastname, contacts.lastname),
          phone         = COALESCE(excluded.phone, contacts.phone),
          address_line1 = COALESCE(excluded.address_line1, contacts.address_line1),
          address_line2 = COALESCE(excluded.address_line2, contacts.address_line2),
          city          = COALESCE(excluded.city, contacts.city),
          state         = COALESCE(excluded.state, contacts.state),
          zip           = COALESCE(excluded.zip, contacts.zip),
          contact_group = COALESCE(excluded.contact_group, contacts.contact_group),
          status        = COALESCE(excluded.status, contacts.status),
          updated_at    = excluded.updated_at
      `).bind(
        crypto.randomUUID(),
        strOrNull(c.external_id),
        strOrNull(c.firstname),
        strOrNull(c.lastname),
        email,
        strOrNull(c.phone),
        strOrNull(c.address_line1),
        strOrNull(c.address_line2),
        strOrNull(c.city),
        strOrNull(c.state),
        strOrNull(c.zip),
        strOrNull(c.contact_group),
        (c.status || "active").toLowerCase(),
        now,
        now
      )
    );
  }

  if (!stmts.length) return json({ status: "error", message: "No valid rows (missing emails)." }, 400);

  await env.DB.batch(stmts);

  return json({
    status: "ok",
    processed,
    skipped,
    statements: stmts.length,
    note: "Atomic upsert-by-email completed."
  });
}

async function exportContacts(env) {
  const res = await env.DB.prepare(`
    SELECT external_id, firstname, lastname, email, phone,
           address_line1, address_line2, city, state, zip,
           contact_group, status
    FROM contacts
    ORDER BY COALESCE(lastname,''), COALESCE(firstname,''), email
    LIMIT 5000
  `).all();

  const headers = [
    "Email",
    "First Name",
    "Last Name",
    "Phone Number",
    "Address Line 1",
    "Address Line 2",
    "City",
    "State",
    "Zip",
    "Rep Group",
    "Status",
    "External ID"
  ];

  const lines = [headers.join(",")];

  for (const r of res.results) {
    lines.push([
      csvEscape(r.email),
      csvEscape(r.firstname),
      csvEscape(r.lastname),
      csvEscape(r.phone),
      csvEscape(r.address_line1),
      csvEscape(r.address_line2),
      csvEscape(r.city),
      csvEscape(r.state),
      csvEscape(r.zip),
      csvEscape(r.contact_group),
      csvEscape(r.status),
      csvEscape(r.external_id)
    ].join(","));
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts_export.csv"`
    }
  });
}