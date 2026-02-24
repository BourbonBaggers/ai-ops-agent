import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { OpenAIProvider } from "../src/providers/openaiProvider.js";
import { mergeCandidateIntoTemplate } from "../src/lib/template_merge.js";

const TEMPLATE_PATH = path.resolve(process.cwd(), "docs/template.html");
const DOWNLOADS_DIR = path.join(os.homedir(), "Downloads");
const ASSET_LIBRARY_URL = "https://assets.boozebaggers.com";
const UNSUBSCRIBE_LINK = "%%unsubscribe%%";

const args = parseArgs(process.argv.slice(2));
const outputDir = args.output_dir || DOWNLOADS_DIR;
const templateHtml = await fs.readFile(TEMPLATE_PATH, "utf8");

const provider = new OpenAIProvider({
  baseUrl: args.base_url || process.env.BASE_URL,
});

const candidates = await provider.generateCandidates({
  variation_hint: args.variation_hint ?? null,
});

if (!Array.isArray(candidates) || candidates.length !== 3) {
  throw new Error(`Expected exactly 3 candidates, got ${Array.isArray(candidates) ? candidates.length : "invalid"}`);
}

const stamp = formatTimestamp(new Date());
const files = [];

for (let i = 0; i < candidates.length; i++) {
  const candidate = candidates[i];
  const index = i + 1;
  const shortid = crypto.randomBytes(4).toString("hex");
  const baseName = `bourbon-baggers-preview_${stamp}_${index}_${shortid}`;
  const htmlPath = await resolveUniquePath(outputDir, `${baseName}.html`);
  const txtPath = htmlPath.replace(/\.html$/i, ".txt");

  const mergedHtml = mergeCandidateIntoTemplate(templateHtml, candidate, {
    assetLibraryUrl: ASSET_LIBRARY_URL,
    unsubscribeLink: UNSUBSCRIBE_LINK,
  });

  await fs.writeFile(htmlPath, mergedHtml, "utf8");
  await fs.writeFile(
    txtPath,
    candidate.body_text ?? candidate.bodyText ?? candidate.body ?? "",
    "utf8"
  );

  files.push({ index, html: htmlPath, text: txtPath });
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      count: files.length,
      files,
    },
    null,
    2
  )
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--variation_hint" || token === "--variation-hint") {
      parsed.variation_hint = argv[i + 1] ?? "";
      i++;
      continue;
    }
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

function formatTimestamp(date) {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

async function resolveUniquePath(dir, fileName) {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  try {
    await fs.access(target);
    const ext = path.extname(fileName);
    const base = fileName.slice(0, -ext.length);
    return path.join(dir, `${base}_${crypto.randomBytes(2).toString("hex")}${ext}`);
  } catch {
    return target;
  }
}
