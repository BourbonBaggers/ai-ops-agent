import { str } from "./utils.js";

export function parseCsv(text) {
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

  if (cur.length || row.length) {
    row.push(cur);
    rows.push(row);
  }

  // Drop trailing blank lines
  while (rows.length && rows[rows.length - 1].every(c => (c || "").trim() === "")) rows.pop();
  if (!rows.length) return [];

  const header = rows[0].map(h => (h || "").trim());
  const body = rows.slice(1);

  return body
    .filter(r => r.some(c => (c || "").trim() !== ""))
    .map(r => {
      const obj = {};
      for (let i = 0; i < header.length; i++) obj[header[i]] = r[i] ?? "";
      return obj;
    });
}

// Map CSV row to contact shape (accepts common header variants)
export function mapContactRow(r) {
  const get = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined) return str(r[k]);
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

export function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}