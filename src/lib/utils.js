export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
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
  if (!p) return "/";
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

export function toYMD(value, label = "date") {
  if (value == null) throw new Error(`${label} is required`);
  const s = String(value).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try to parse anything else into a Date
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`${label} must be YYYY-MM-DD (got "${s}")`);
  }

  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ISO-ish timestamp anchored to a timezone: YYYY-MM-DDTHH:MM:SS
export function nowInTzISO(tz) {
  const s = new Date().toLocaleString("sv-SE", { timeZone: tz });
  return s.replace(" ", "T");
}

// Monday YYYY-MM-DD for the current week in the provided timezone
export function getWeekOf(tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const d = parts.find(p => p.type === "day")?.value;

  const dt = new Date(`${y}-${m}-${d}T00:00:00Z`);

  const dow = dt.getUTCDay(); // Sun=0..Sat=6
  const deltaToMonday = (dow === 0 ? -6 : 1 - dow);

  dt.setUTCDate(dt.getUTCDate() + deltaToMonday);

  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Returns dow/hhmm in tz (for schedule comparison)
export function getPartsInTz(now, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = fmt.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  return {
    dow: parts.weekday.toUpperCase(),
    hhmm: `${parts.hour}:${parts.minute}`
  };
}

// Backward-compatible: UTC ISO timestamp
export function nowIso() {
  return new Date().toISOString();
}