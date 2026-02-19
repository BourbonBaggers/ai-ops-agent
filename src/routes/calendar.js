import { json, normalizePath, badRequest } from "../lib/utils.js";
import { getWeekOf, addDays } from "../lib/time.js";

function isYmd(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}


export async function handleCalendar(request, env) {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);

  if (request.method !== "GET") {
    return json({ status: "error", message: "Not found" }, 404);
  }

const q = new URL(request.url).searchParams;
const week_of = q.get("week_of");
let from = q.get("from");
let to = q.get("to");

if (week_of) {
  if (!isYmd(week_of)) throw badRequest("Query param 'week_of' must be YYYY-MM-DD");
  from = week_of;
  to = addDays(week_of, 7); // or 6 if you mean inclusive end-date
} else {
  if (!isYmd(from) || !isYmd(to)) {
    throw badRequest("Query params 'from' and 'to' must be YYYY-MM-DD");
  }
}

  // ... existing calendar query logic using from/to ...

  return json({
    status: "ok",
    week_of: week_of ?? null, // <-- add this
    from,
    to,
    // ...whatever else you return...
  });
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

