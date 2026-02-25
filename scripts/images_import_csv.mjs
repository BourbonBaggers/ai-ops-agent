import fs from "node:fs/promises";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  throw new Error("Missing --file <path-to-csv>");
}

const baseUrl = stripTrailingSlash(args.base_url || process.env.BASE_URL || DEFAULT_BASE_URL);
const csv = await fs.readFile(args.file, "utf8");

const res = await fetch(`${baseUrl}/admin/email_images/upload`, {
  method: "POST",
  headers: { "content-type": "text/csv; charset=utf-8" },
  body: csv,
});

const body = await res.text();
let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  parsed = { raw: body };
}

console.log(
  JSON.stringify(
    {
      status: res.ok ? "ok" : "error",
      http_status: res.status,
      response: parsed,
    },
    null,
    2
  )
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--file") {
      parsed.file = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (token === "--base_url" || token === "--base-url") {
      parsed.base_url = argv[i + 1] ?? "";
      i++;
      continue;
    }
  }
  return parsed;
}

function stripTrailingSlash(v) {
  return String(v || "").replace(/\/+$/, "");
}
