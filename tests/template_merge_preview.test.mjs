import test from "node:test";
import assert from "node:assert/strict";
import { mergeCandidateIntoTemplate } from "../src/lib/template_merge.js";

test("template merge replaces body/preview tokens and handles null image_url", () => {
  const template = `
    <html>
      <head><title>{{SUBJECT}}</title></head>
      <body>
        <div style="display:none">{{PREVIEW_TEXT}}</div>
        {{#if IMAGE_URL}}<img src="{{IMAGE_URL}}" alt="hero" />{{/if}}
        <section>{{BODY_HTML}}</section>
        <a href="{{ASSET_LIBRARY_URL}}">Assets</a>
        <a href="{{UNSUBSCRIBE_LINK}}">Unsub</a>
      </body>
    </html>
  `;

  const candidate = {
    subject: "Weekly rep note",
    preview: "This is preview text",
    body_html: "<p>Body fragment here.</p>",
    body_text: "Body fragment here.",
    cta: "Bring this up with three accounts this week.",
    image_url: null,
    funnel_stage: "top",
    variation_hint: null,
  };

  const html = mergeCandidateIntoTemplate(template, candidate);

  assert.ok(!html.includes("{{BODY_HTML}}"));
  assert.ok(!html.includes("{{PREVIEW_TEXT}}"));
  assert.ok(html.includes("<p>Body fragment here.</p>"));
  assert.ok(html.includes("https://assets.boozebaggers.com"));
  assert.ok(!html.includes("{{IMAGE_URL}}"));
  assert.ok(!/src\s*=\s*""/i.test(html));
  assert.ok(!/src\s*=\s*''/i.test(html));
});

test("template merge injects ACTION_TITLE, QUOTE_LINE, RALLY_LINE, CTA_TEXT", () => {
  const template = `
    <html><body>
      <p>{{ACTION_TITLE}}</p>
      <blockquote>{{QUOTE_LINE}}</blockquote>
      <p>{{RALLY_LINE}}</p>
      <p>{{CTA_TEXT}}</p>
    </body></html>
  `;

  const candidate = {
    subject: "Test subject",
    preview: "Preview text",
    body_html: "<p>Body.</p>",
    action_line: "Put it into action with 3 accounts.",
    quote_text: "This one sells itself.",
    rally_line: "No liquor license required.",
    cta: "Reply for more info",
    image_url: null,
  };

  const html = mergeCandidateIntoTemplate(template, candidate);

  assert.ok(html.includes("Put it into action with 3 accounts."), "ACTION_TITLE not injected");
  assert.ok(html.includes("This one sells itself."), "QUOTE_LINE not injected");
  assert.ok(html.includes("No liquor license required."), "RALLY_LINE not injected");
  assert.ok(html.includes("Reply for more info"), "CTA_TEXT not injected");
  assert.ok(!html.includes("{{ACTION_TITLE}}"), "ACTION_TITLE token not replaced");
  assert.ok(!html.includes("{{QUOTE_LINE}}"), "QUOTE_LINE token not replaced");
  assert.ok(!html.includes("{{RALLY_LINE}}"), "RALLY_LINE token not replaced");
  assert.ok(!html.includes("{{CTA_TEXT}}"), "CTA_TEXT token not replaced");
});

test("template merge uses default ACTION_TITLE when action_line is missing", () => {
  const template = `<p>{{ACTION_TITLE}}</p>`;
  const candidate = { subject: "S", preview: "P", body_html: "<p>B</p>", cta: "C", image_url: null };
  const html = mergeCandidateIntoTemplate(template, candidate);
  assert.ok(html.includes("Put it into action..."), "default ACTION_TITLE not used");
});
