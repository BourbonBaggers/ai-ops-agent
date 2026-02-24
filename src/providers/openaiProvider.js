import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), "docs/policy.md");

export class OpenAIProvider {
  constructor({
    apiKey = process.env.OPEN_AI_KEY,
    model = process.env.OPENAI_MODEL || DEFAULT_MODEL,
    openAiUrl = DEFAULT_OPENAI_URL,
    baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL,
    assetsPath = "/admin/assets",
    fetchImpl = fetch,
    policyPath = DEFAULT_POLICY_PATH,
    policyText = null,
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.openAiUrl = openAiUrl;
    this.baseUrl = baseUrl;
    this.assetsPath = assetsPath;
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
    const { allowlistedUrls, allowlistedItems } = await this.fetchAssetAllowlist(input);
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

  async fetchAssetAllowlist(input = {}) {
    const baseUrl = stripTrailingSlash(input.baseUrl || this.baseUrl || DEFAULT_BASE_URL);
    const assetsUrl = input.assetsUrl || `${baseUrl}${this.assetsPath}`;
    const res = await this.fetchImpl(assetsUrl);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to fetch allowlist (${res.status}): ${text}`);
    }

    const payload = parseStrictJson(text);
    const flat = Array.isArray(payload?.flat) ? payload.flat : [];
    const allowlistedItems = flat
      .map((item) => ({
        productName: toNullableString(item?.productName),
        key: toNullableString(item?.key),
        url: toNullableString(item?.url),
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
      ? allowlistedItems.map((item) => `- ${item.url}`).join("\n")
      : "- (none)";

  const userPrompt = [
    "Follow the policy exactly and return JSON only.",
    "",
    `variation_hint: ${variationHint ?? "null"}`,
    "",
    "Approved image URL allowlist:",
    allowlistText,
    "",
    "Policy:",
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
            content:
              "You generate internal sales enablement weekly email candidates. Return strict JSON only.",
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

  const requestedImageUrl = toNullableString(candidate.image_url);
  const image_url =
    requestedImageUrl && allowlistedUrls.has(requestedImageUrl) ? requestedImageUrl : null;

  const variation_hint = toNullableString(candidate.variation_hint);

  return {
    funnel_stage,
    subject,
    preview,
    body_html,
    body_text,
    body: body_text,
    cta,
    image_url,
    variation_hint,
    preview_text: preview,
    body_markdown: body_text,
    image_refs: image_url ? [image_url] : [],
    self_check: {},
  };
}

function normalizeFunnelStage(value) {
  const v = toNullableString(value);
  if (v === "top" || v === "mid" || v === "bottom") return v;
  throw new Error(`Invalid funnel_stage: ${value}`);
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
