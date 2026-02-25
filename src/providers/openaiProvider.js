import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), "docs/policy.md");
const DEFAULT_IMAGE_LIMIT = 150;

export class OpenAIProvider {
  constructor({
    apiKey = process.env.OPEN_AI_KEY,
    model = process.env.OPENAI_MODEL || DEFAULT_MODEL,
    openAiUrl = DEFAULT_OPENAI_URL,
    baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL,
    imageCatalogPath = "/admin/email_images",
    imageLimit = DEFAULT_IMAGE_LIMIT,
    db = null,
    fetchImpl = fetch,
    policyPath = DEFAULT_POLICY_PATH,
    policyText = null,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.openAiUrl = openAiUrl;
    this.baseUrl = baseUrl;
    this.imageCatalogPath = imageCatalogPath;
    this.imageLimit = imageLimit;
    this.db = db;
    this.fetchImpl = fetchImpl;
    this.policyPath = policyPath;
    this.policyText = policyText;
  }

  async generateCandidates(input = {}) {
    if (!this.apiKey) {
      throw new Error("OPEN_AI_KEY is required");
    }

    const variationHint = toNullableString(
      input.variation_hint ?? input.variationHint ?? null
    );
    const { allowlistedUrls, allowlistedItems } = await this.fetchImageCatalog(input);
    const policy = await this.loadPolicyText(input);
    const rawText = await this.callOpenAI({ policy, allowlistedItems, variationHint });
    const parsed = parseStrictJson(rawText);

    if (!Array.isArray(parsed?.candidates)) {
      throw new Error("OpenAI JSON must contain a candidates array");
    }
    if (parsed.candidates.length !== 3) {
      throw new Error(`OpenAI must return exactly 3 candidates, got ${parsed.candidates.length}`);
    }

    return parsed.candidates.map((candidate, idx) =>
      normalizeCandidate(candidate, idx, allowlistedUrls)
    );
  }

  async fetchImageCatalog(input = {}) {
    const limit = clampInt(input.imageLimit ?? this.imageLimit, 1, 500, DEFAULT_IMAGE_LIMIT);
    const db = input.db || this.db;
    if (db) {
      return this.fetchImageCatalogFromDb(db, limit);
    }

    const baseUrl = stripTrailingSlash(input.baseUrl || this.baseUrl || DEFAULT_BASE_URL);
    const endpointUrl = input.imageCatalogUrl || `${baseUrl}${this.imageCatalogPath}?limit=${limit}`;
    const res = await this.fetchImpl(endpointUrl);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to fetch image catalog (${res.status}): ${text}`);
    }

    const payload = parseStrictJson(text);
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const allowlistedItems = rows
      .map((item) => ({
        productName: toNullableString(item?.product_name ?? item?.productName),
        url: toNullableString(item?.url),
        alt: toNullableString(item?.alt),
        description: toNullableString(item?.description),
      }))
      .filter((item) => item.url);

    return {
      allowlistedUrls: new Set(allowlistedItems.map((item) => item.url)),
      allowlistedItems,
    };
  }

  async fetchImageCatalogFromDb(db, limit) {
    const rows = await db.prepare(`
      SELECT url, alt, description, product_name
      FROM email_images
      ORDER BY COALESCE(product_name, ''), url
      LIMIT ?
    `).bind(limit).all();

    const allowlistedItems = (rows?.results || [])
      .map((item) => ({
        productName: toNullableString(item?.product_name),
        url: toNullableString(item?.url),
        alt: toNullableString(item?.alt),
        description: toNullableString(item?.description),
      }))
      .filter((item) => item.url);

    return {
      allowlistedUrls: new Set(allowlistedItems.map((item) => item.url)),
      allowlistedItems,
    };
  }

  async loadPolicyText(input = {}) {
    if (typeof input.policyText === "string") return input.policyText;
    if (typeof this.policyText === "string") return this.policyText;
    const policyPath = input.policyPath || this.policyPath;
    return fs.readFile(policyPath, "utf8");
  }

  async callOpenAI({ policy, allowlistedItems, variationHint }) {
    const allowlistText = allowlistedItems.length
      ? allowlistedItems
          .map((item) =>
            `- url: ${item.url}\n  alt: ${item.alt || ""}\n  description: ${item.description || ""}`
          )
          .join("\n")
      : "- (none)";

    // All behavioral instructions live in the policy doc.
    // This prompt only provides the three dynamic inputs: allowlist, variation hint, and policy.
    const userPrompt = [
      `variation_hint: ${variationHint ?? "null"}`,
      "",
      "Approved image URL allowlist:",
      allowlistText,
      "",
      policy,
    ].join("\n");

    const res = await this.fetchImpl(this.openAiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return strict JSON only.",
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenAI request failed (${res.status}): ${text}`);
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`OpenAI response was not valid JSON: ${text}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`OpenAI response missing message content: ${text}`);
    }

    return content.trim();
  }
}

function parseStrictJson(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Expected strict JSON but got: ${rawText}`);
  }
}

function normalizeCandidate(candidate, idx, allowlistedUrls) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(`Candidate ${idx + 1} is not an object`);
  }

  const funnel_stage = normalizeFunnelStage(candidate.funnel_stage);
  const subject = mustString(candidate.subject, `Candidate ${idx + 1} subject`);
  const preview = mustString(candidate.preview, `Candidate ${idx + 1} preview`);
  const body_html = mustString(
    candidate.body_html ?? candidate.bodyHtml ?? candidate.body,
    `Candidate ${idx + 1} body_html`
  );
  const body_text = mustString(
    candidate.body_text ?? candidate.bodyText ?? candidate.body,
    `Candidate ${idx + 1} body_text`
  );
  const cta = mustString(candidate.cta, `Candidate ${idx + 1} cta`);

  // Template action-section components (optional — empty string if omitted)
  const action_line = toNullableString(candidate.action_line);
  const quote_text = toNullableString(candidate.quote_text);
  const rally_line = toNullableString(candidate.rally_line);

  const requestedImageUrl = toNullableString(candidate.image_url);
  const image_url =
    requestedImageUrl && allowlistedUrls.has(requestedImageUrl) ? requestedImageUrl : null;

  const variation_hint = toNullableString(candidate.variation_hint);

  const self_check =
    candidate.self_check && typeof candidate.self_check === "object"
      ? candidate.self_check
      : {};

  return {
    funnel_stage,
    subject,
    preview,
    body_html,
    body_text,
    body: body_text,
    action_line,
    quote_text,
    rally_line,
    cta,
    image_url,
    variation_hint,
    preview_text: preview,
    body_markdown: body_text,
    image_refs: image_url ? [image_url] : [],
    self_check,
  };
}

function normalizeFunnelStage(value) {
  const v = toNullableString(value);
  if (v === "top" || v === "mid" || v === "bottom") return v;
  throw new Error(`Invalid funnel_stage: ${value}`);
}

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v ?? "", 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function stripTrailingSlash(v) {
  return String(v || "").replace(/\/+$/, "");
}

function toNullableString(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function mustString(v, label) {
  const s = toNullableString(v);
  if (!s) throw new Error(`${label} is required`);
  return s;
}
