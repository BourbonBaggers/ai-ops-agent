import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminUi } from "../src/routes/admin_ui.js";

test("GET /admin/ui returns HTML shell", async () => {
  const req = new Request("http://localhost/admin/ui", { method: "GET" });
  const res = await handleAdminUi(req, { DB: new NoopDb() });

  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/i);

  const html = await res.text();
  assert.match(html, /<title>Admin UI<\/title>/);
  assert.match(html, /id="admin-ui-root"/);
  assert.match(html, /id="weekInput"/);
  assert.match(html, /<script src="\/admin\/ui\/app\.js"><\/script>/);
});

test("GET /admin/ui/app.js returns executable JS", async () => {
  const req = new Request("http://localhost/admin/ui/app.js", { method: "GET" });
  const res = await handleAdminUi(req, { DB: new NoopDb() });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /application\/javascript/i);
  const js = await res.text();
  assert.match(js, /\(function clientApp\(stages\)/);
  assert.match(js, /reloadWeek\(weekInput\.value\)/);
  assert.doesNotThrow(() => new Function(js));
});

test("GET /admin/ui_api/preview returns merged html for candidate_id", async () => {
  const candidate = {
    id: "cand-1",
    weekly_run_id: "run-1",
    subject: "Subject A",
    preview_text: "Preview A",
    body_markdown: "Plain body",
    body_html: "<p>Hello preview</p>",
    image_url: null,
    cta: "Call now",
    action_line: "Act",
    quote_text: "Quote",
    rally_line: "Rally",
    funnel_stage: "top",
    created_at: "2026-03-04T00:00:00Z",
  };

  const req = new Request("http://localhost/admin/ui_api/preview?candidate_id=cand-1", {
    method: "GET",
  });

  const env = {
    EMAIL_TEMPLATE_HTML: "<html><body>{{PREVIEW_TEXT}}{{BODY_HTML}}{{UNSUBSCRIBE_LINK}}</body></html>",
    ASSET_LIBRARY_URL: "https://assets.boozebaggers.com",
    DB: new PreviewDb(candidate),
  };

  const res = await handleAdminUi(req, env);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.candidate_id, "cand-1");
  assert.match(body.merged_html, /Hello preview/);
  assert.match(body.merged_html, /Preview A/);
  assert.match(body.merged_html, /%%unsubscribe%%/);
  assert.equal(body.plain_text, "Plain body");
});

class NoopDb {
  prepare() {
    throw new Error("DB should not be called for /admin/ui");
  }
}

class PreviewDb {
  constructor(candidate) {
    this.candidate = candidate;
  }

  prepare(sql) {
    const normalized = normalize(sql);

    if (normalized.includes("FROM CANDIDATES") && normalized.includes("WHERE ID = ?")) {
      return {
        bind: (id) => ({
          first: async () => (id === this.candidate.id ? { ...this.candidate } : null),
        }),
      };
    }

    if (normalized.includes("FROM CONFIG") && normalized.includes("EMAIL_TEMPLATE_HTML")) {
      return {
        first: async () => null,
      };
    }

    throw new Error(`Unsupported SQL in test DB: ${sql}`);
  }
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toUpperCase();
}
