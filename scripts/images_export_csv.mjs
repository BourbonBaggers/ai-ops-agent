import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { csvEscape } from "../src/lib/csv.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_DOWNLOADS = path.join(os.homedir(), "Downloads");

const args = parseArgs(process.argv.slice(2));
const baseUrl = stripTrailingSlash(args.base_url || process.env.BASE_URL || DEFAULT_BASE_URL);
const outDir = args.output_dir || DEFAULT_DOWNLOADS;
const timestamp = formatTimestamp(new Date());

const res = await fetch(`${baseUrl}/admin/assets`);
const text = await res.text();
if (!res.ok) {
  throw new Error(`Failed to fetch /admin/assets (${res.status}): ${text}`);
}

const payload = JSON.parse(text);
const flat = Array.isArray(payload?.flat) ? payload.flat : [];

const headers = ["url", "alt", "description", "product_name"];
const lines = [headers.join(",")];

for (const item of flat) {
  const key = String(item?.key || "");
  const filename = key.split("/").pop() || "";
  const baseName = filename.replace(/\.[^.]+$/, "");
  const alt = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const description = "TODO: describe best use";

  lines.push(
    [
      csvEscape(item?.url || ""),
      csvEscape(alt),
      csvEscape(description),
      csvEscape(item?.productName || ""),
    ].join(",")
  );
}

await fs.mkdir(outDir, { recursive: true });
const fileName = await uniqueName(outDir, `email_images_seed_${timestamp}.csv`);
const outPath = path.join(outDir, fileName);
await fs.writeFile(outPath, lines.join("\n"), "utf8");

console.log(
  JSON.stringify(
    { status: "ok", rows: flat.length, path: outPath },
    null,
    2
  )
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--base_url" || token === "--base-url") {
      parsed.base_url = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (token === "--output_dir" || token === "--output-dir") {
      parsed.output_dir = argv[i + 1] ?? "";
      i++;
      continue;
    }
  }
  return parsed;
}

function stripTrailingSlash(v) {
  return String(v || "").replace(/\/+$/, "");
}

function formatTimestamp(d) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

async function uniqueName(dir, preferredName) {
  const preferredPath = path.join(dir, preferredName);
  try {
    await fs.access(preferredPath);
  } catch {
    return preferredName;
  }

  const ext = path.extname(preferredName);
  const base = preferredName.slice(0, -ext.length);
  return `${base}_${Date.now()}${ext}`;
}
