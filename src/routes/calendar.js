import { json, normalizePath } from "../lib/utils.js";
import { nowUtcIso, nowInTzISO, getWeekOf } from "../lib/time.js";

// GET /admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// POST /admin/calendar/load  (CSV in body)

export async function handleCalendar(request, env) {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();

  if (path === "/admin/calendar" && method === "GET") {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!isDate(from) || !isDate(to)) {
      return json({ status: "error", message: "Query params 'from' and 'to' must be YYYY-MM-DD" }, 400);
    }

    const rows = await env.DB.prepare(
      `SELECT id, date, category, title, notes, created_at
       FROM calendar_items
       WHERE date >= ? AND date <= ?
       ORDER BY date ASC, category ASC, title ASC`
    ).bind(from, to).all();

    return json({ status: "ok", count: rows.results.length, items: rows.results });
  }

  // CSV loader (atomic replace of date range contained in file)
  if (path === "/admin/calendar/load" && method === "POST") {
    const csv = (await request.text()).trim();
    if (!csv) return json({ status: "error", message: "Empty body" }, 400);

    const parsed = parseCsvCalendar(csv);
    if (parsed.errors.length) {
      return json({ status: "error", message: "CSV validation failed", errors: parsed.errors }, 400);
    }

    // Determine range to replace (Option A)
    const dates = parsed.items.map(x => x.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];

    const now = nowUtcIso();

    // Build atomic batch: delete range, insert all
    const stmts = [];
    stmts.push(
      env.DB.prepare(`DELETE FROM calendar_items WHERE date >= ? AND date <= ?`).bind(minDate, maxDate)
    );

    for (const item of parsed.items) {
      stmts.push(
        env.DB.prepare(`
          INSERT INTO calendar_items (id, date, category, title, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          item.date,
          item.category,
          item.title,
          item.notes ?? null,
          now
        )
      );
    }

    await env.DB.batch(stmts);

    return json({
      status: "ok",
      replaced_range: { from: minDate, to: maxDate },
      inserted: parsed.items.length
    });
  }

  return json({ status: "error", message: "Not found" }, 404);
}

function parseCsvCalendar(csvText) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  const errors = [];
  if (lines.length < 2) return { items: [], errors: ["CSV must include header and at least one row"] };

  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const required = ["date", "category", "title"];
  for (const r of required) {
    if (!header.includes(r)) errors.push(`Missing required column: ${r}`);
  }
  if (errors.length) return { items: [], errors };

  const idx = {
    date: header.indexOf("date"),
    category: header.indexOf("category"),
    title: header.indexOf("title"),
    notes: header.indexOf("notes"),
  };

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const rowNum = i + 1;

    const date = (cols[idx.date] ?? "").trim();
    const category = (cols[idx.category] ?? "").trim();
    const title = (cols[idx.title] ?? "").trim();
    const notes = idx.notes >= 0 ? (cols[idx.notes] ?? "").trim() : "";

    if (!isDate(date)) errors.push(`Row ${rowNum}: invalid date '${date}' (expected YYYY-MM-DD)`);
    if (!category) errors.push(`Row ${rowNum}: category is required`);
    if (!title) errors.push(`Row ${rowNum}: title is required`);

    items.push({
      date,
      category,
      title,
      notes: notes || null
    });
  }

  return { items, errors };
}

// Minimal CSV splitting with quotes support
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // double-quote escape
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function isDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}