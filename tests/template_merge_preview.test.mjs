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
