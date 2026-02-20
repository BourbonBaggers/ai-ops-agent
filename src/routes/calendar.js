import { json, normalizePath, badRequest } from "../lib/utils.js";
import { addDays, isYmd } from "../lib/time.js";


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
  to = addDays(week_of, 6); // Mon–Sun inclusive
} else {
  if (!isYmd(from) || !isYmd(to)) {
    throw badRequest("Query params 'from' and 'to' must be YYYY-MM-DD");
  }
}

  const rows = await env.DB.prepare(`
    SELECT id, date, category, title, notes
    FROM calendar_items
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC
  `).bind(from, to).all();

  return json({
    status: "ok",
    week_of: week_of ?? null,
    from,
    to,
    count: rows.results.length,
    items: rows.results,
  });
}

