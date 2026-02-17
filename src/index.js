export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/debug/whereami") {
      return json({
        method: request.method,
        path: url.pathname,
        host: url.host
      });
    }

    // Health check
    if (url.pathname === "/health") {
      try {
        const result = await env.DB.prepare("SELECT 1 as ok").first();
        return json({ status: "ok", db: result.ok === 1 });
      } catch (err) {
        return json({ status: "error", message: err.message }, 500);
      }
    }

    // Seed endpoint (admin only via Access)
    if (url.pathname === "/admin/seed" && request.method === "POST") {
      try {
        const policyId = crypto.randomUUID();
        const calendarId = crypto.randomUUID();

        await env.DB.prepare(`
          INSERT INTO policy_versions (id, is_active, title, body_markdown)
          VALUES (?, 1, ?, ?)
        `).bind(policyId, "Initial Policy", "This is a placeholder standards policy.").run();

        await env.DB.prepare(`
          INSERT INTO calendar_items (id, date, category, title, notes)
          VALUES (?, ?, ?, ?, ?)
        `).bind(
          calendarId,
          "2026-01-01",
          "holiday",
          "New Year Example",
          "Placeholder calendar item."
        ).run();

        return json({ status: "seeded" });

      } catch (err) {
        return json({ status: "error", message: err.message }, 500);
      }
    }

    // ============================================================
    // CONTACTS (Admin)
    // ============================================================

    // GET /admin/contacts?status=active&limit=200&offset=0
    if (url.pathname === "/admin/contacts" && request.method === "GET") {
    try {
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
    } catch (err) {
        return json({ status: "error", message: err.message }, 500);
    }
    }

    // POST /admin/contacts (create one)
    // Body JSON: { firstname, lastname, email, phone, address_line1, address_line2, city, state, zip, contact_group, status, external_id }
    if (url.pathname === "/admin/contacts" && request.method === "POST") {
    try {
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
        (str(body.status).toLowerCase() || "active"),
        now,
        now
        ).run();

        return json({ status: "ok", id });
    } catch (err) {
        // Likely UNIQUE(email)
        return json({ status: "error", message: err.message }, 500);
    }
    }

    // PUT /admin/contacts/:id (update one)
    if (url.pathname.startsWith("/admin/contacts/") && request.method === "PUT") {
    try {
        const id = url.pathname.split("/").pop();
        if (!id) return json({ status: "error", message: "missing id" }, 400);

        const body = await request.json();
        const exists = await env.DB.prepare(`SELECT id FROM contacts WHERE id = ?`).bind(id).first();
        if (!exists) return json({ status: "error", message: "not found" }, 404);

        // email optional but must stay valid + unique
        const email = body.email !== undefined ? normalizeEmail(body.email) : null;
        if (body.email !== undefined && !email) {
        return json({ status: "error", message: "invalid email" }, 400);
        }

        const now = nowIso();

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
        body.status      !== undefined ? (str(body.status).toLowerCase() || null) : null,
        now,
        id
        ).run();

        return json({ status: "ok", id });
    } catch (err) {
        return json({ status: "error", message: err.message }, 500);
    }
    }

    // POST /admin/contacts/import (multipart/form-data with file field named "file")
    // Idempotent by email: insert if new, update if existing
    if (url.pathname === "/admin/contacts/import" && request.method === "POST") {
    try {
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
        if (rows.length === 0) return json({ status: "error", message: "CSV has no rows." }, 400);

        const mapped = rows.map(mapContactRow);

        let inserted = 0, updated = 0, skipped = 0, errors = 0;
        const errorSamples = [];
        const now = nowIso();

        // Simple per-row approach (fine for ~70-500 contacts)
        for (const c of mapped) {
        const email = normalizeEmail(c.email);
        if (!email) { skipped++; continue; }

        try {
            const existing = await env.DB.prepare(`SELECT id FROM contacts WHERE email = ?`).bind(email).first();

            if (!existing) {
            await env.DB.prepare(`
                INSERT INTO contacts (
                id, external_id, firstname, lastname, email, phone,
                address_line1, address_line2, city, state, zip,
                contact_group, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                crypto.randomUUID(),
                c.external_id || null,
                c.firstname || null,
                c.lastname || null,
                email,
                c.phone || null,
                c.address_line1 || null,
                c.address_line2 || null,
                c.city || null,
                c.state || null,
                c.zip || null,
                c.contact_group || null,
                (c.status || "active").toLowerCase(),
                now,
                now
            ).run();
            inserted++;
            } else {
            await env.DB.prepare(`
                UPDATE contacts SET
                external_id   = COALESCE(?, external_id),
                firstname     = COALESCE(?, firstname),
                lastname      = COALESCE(?, lastname),
                phone         = COALESCE(?, phone),
                address_line1 = COALESCE(?, address_line1),
                address_line2 = COALESCE(?, address_line2),
                city          = COALESCE(?, city),
                state         = COALESCE(?, state),
                zip           = COALESCE(?, zip),
                contact_group = COALESCE(?, contact_group),
                status        = COALESCE(?, status),
                updated_at    = ?
                WHERE email = ?
            `).bind(
                c.external_id || null,
                c.firstname || null,
                c.lastname || null,
                c.phone || null,
                c.address_line1 || null,
                c.address_line2 || null,
                c.city || null,
                c.state || null,
                c.zip || null,
                c.contact_group || null,
                (c.status || "active").toLowerCase(),
                now,
                email
            ).run();
            updated++;
            }
        } catch (err) {
            errors++;
            if (errorSamples.length < 10) errorSamples.push({ email: c.email, error: err.message });
        }
        }

        return json({
        status: "ok",
        processed: mapped.length,
        inserted,
        updated,
        skipped,
        errors,
        errorSamples
        });
    } catch (err) {
        return json({ status: "error", message: err.message }, 500);
    }
    }

    // GET /admin/contacts/export (HubSpot-ish CSV)
    if (url.pathname === "/admin/contacts/export" && request.method === "GET") {
    try {
        const res = await env.DB.prepare(`
        SELECT external_id, firstname, lastname, email, phone,
                address_line1, address_line2, city, state, zip,
                contact_group, status
        FROM contacts
        ORDER BY COALESCE(lastname,''), COALESCE(firstname,''), email
        LIMIT 5000
        `).all();

        const csv = toHubSpotCsv(res.results);
        return new Response(csv, {
        headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="contacts_export.csv"`
        }
        });
    } catch (err) {
        return json({ status: "error", message: err.message }, 500);
    }
    }

    return new Response("ai-ops-agent running");
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function nowIso() {
  return new Date().toISOString();
}

function str(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function strOrNull(v) {
  const s = str(v);
  return s.length ? s : null;
}

function normalizeEmail(e) {
  const s = str(e).toLowerCase();
  return s.includes("@") ? s : "";
}

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

// -------- CSV parsing (simple, robust enough for exported lists) --------

// Supports quoted fields with commas and double-quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch === "\r") {
      // ignore
    } else {
      cur += ch;
    }
  }

  // last cell
  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  // Drop trailing blank lines
  while (rows.length && rows[rows.length - 1].every(c => (c || "").trim() === "")) rows.pop();

  if (!rows.length) return [];

  // Header row normalization
  const header = rows[0].map(h => (h || "").trim());
  const body = rows.slice(1);

  // Convert to objects by header names
  return body
    .filter(r => r.some(c => (c || "").trim() !== ""))
    .map(r => {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = r[i] ?? "";
      return obj;
    });
}

// Map CSV row to our contact shape.
// Accepts several common header variants (HubSpot-ish + your field names).
function mapContactRow(r) {
  const get = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined) return str(r[k]);
      // case-insensitive match
      const foundKey = Object.keys(r).find(x => x.trim().toLowerCase() === k.trim().toLowerCase());
      if (foundKey) return str(r[foundKey]);
    }
    return "";
  };

  return {
    external_id: get("External ID", "external_id", "ExternalId", "externalId"),
    firstname: get("First Name", "firstname", "first_name", "FirstName"),
    lastname: get("Last Name", "lastname", "last_name", "LastName"),
    email: get("Email", "email"),
    phone: get("Phone Number", "phone", "Phone"),
    address_line1: get("Address Line 1", "address_line1", "Address", "address"),
    address_line2: get("Address Line 2", "address_line2"),
    city: get("City", "city"),
    state: get("State", "state"),
    zip: get("Zip", "zip", "Postal Code", "postal_code"),
    contact_group: get("Rep Group", "Group", "contact_group", "group"),
    status: (get("Status", "status") || "active").toLowerCase()
  };
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toHubSpotCsv(rows) {
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

  for (const r of rows) {
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

  return lines.join("\n");
}