const DEFAULT_ASSET_LIBRARY_URL = "https://assets.boozebaggers.com";
const DEFAULT_UNSUBSCRIBE_LINK = "%%unsubscribe%%";
const DEFAULT_ACTION_TITLE = "Put it into action...";

export function mergeCandidateIntoTemplate(templateHtml, candidate, options = {}) {
  if (typeof templateHtml !== "string" || !templateHtml.length) {
    throw new Error("templateHtml must be a non-empty string");
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("candidate must be an object");
  }

  const subject = stringOrEmpty(candidate.subject);
  const previewText = stringOrEmpty(candidate.preview ?? candidate.preview_text);
  const bodyHtml = stringOrEmpty(candidate.body_html ?? candidate.bodyHtml ?? candidate.body);
  const imageUrl = normalizeNullableString(candidate.image_url ?? candidate.imageUrl);
  const ctaText = stringOrEmpty(candidate.cta);
  const ctaUrl = stringOrEmpty(options.ctaUrl || "#");
  const imageAlt = stringOrEmpty(options.imageAlt || subject || "Product image");
  const assetLibraryUrl = stringOrEmpty(options.assetLibraryUrl || DEFAULT_ASSET_LIBRARY_URL);
  const unsubscribeLink = stringOrEmpty(options.unsubscribeLink || DEFAULT_UNSUBSCRIBE_LINK);
  const managePrefsUrl = stringOrEmpty(options.managePrefsUrl || unsubscribeLink);

  // Action-section components — provider returns these separately; template injects styling
  const actionTitle = stringOrEmpty(candidate.action_line ?? options.actionTitle ?? DEFAULT_ACTION_TITLE);
  const quoteLine = stringOrEmpty(candidate.quote_text ?? candidate.quote_line);
  const rallyLine = stringOrEmpty(candidate.rally_line);

  let out = templateHtml;

  if (imageUrl) {
    out = out
      .replace(/{{#if\s+image_url}}/gi, "")
      .replace(/{{\/if}}/gi, "");
  } else {
    out = out.replace(/{{#if\s+image_url}}[\s\S]*?{{\/if}}/gi, "");
  }

  out = replaceToken(out, "SUBJECT", subject);
  out = replaceToken(out, "HEADLINE", subject);
  out = replaceToken(out, "PREVIEW_TEXT", previewText);
  out = replaceToken(out, "BODY_HTML", bodyHtml);
  out = replaceToken(out, "ACTION_TITLE", actionTitle);
  out = replaceToken(out, "QUOTE_LINE", quoteLine);
  out = replaceToken(out, "QUOTE_TEXT", quoteLine);
  out = replaceToken(out, "RALLY_LINE", rallyLine);
  out = replaceToken(out, "CTA_TEXT", ctaText);
  out = replaceToken(out, "CTA_URL", ctaUrl);
  out = replaceToken(out, "IMAGE_URL", imageUrl ?? "");
  out = replaceToken(out, "IMAGE_ALT", imageAlt);
  out = replaceToken(out, "ASSET_LIBRARY_URL", assetLibraryUrl);
  out = replaceToken(out, "UNSUBSCRIBE_LINK", unsubscribeLink);
  out = replaceToken(out, "UNSUBSCRIBE_URL", unsubscribeLink);
  out = replaceToken(out, "MANAGE_PREFS_URL", managePrefsUrl);

  out = out.replace(/<img\b[^>]*\bsrc=(["'])\s*\1[^>]*>/gi, "");

  return out;
}

function replaceToken(input, token, value) {
  const rx = new RegExp(`{{\\s*${escapeRegExp(token)}\\s*}}`, "gi");
  return input.replace(rx, value);
}

function normalizeNullableString(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function stringOrEmpty(v) {
  return typeof v === "string" ? v : "";
}

function escapeRegExp(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
