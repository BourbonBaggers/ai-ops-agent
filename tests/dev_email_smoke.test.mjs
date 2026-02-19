// tests/dev_email_smoke.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { postJson, fetchJson, assertJsonBody, assertStatus } from "./_helpers.mjs";

const DEV_EMAIL_KEY = process.env.DEV_EMAIL_KEY;
const DEV_EMAIL_TEST_TO = process.env.DEV_EMAIL_TEST_TO;

test("dev/email smoke: sends with key", async () => {
  assert.ok(DEV_EMAIL_KEY, "DEV_EMAIL_KEY is required for this test");
  assert.ok(DEV_EMAIL_TEST_TO, "DEV_EMAIL_TEST_TO is required for this test");

  const r = await postJson(
    "/dev/email",
    {
      to: DEV_EMAIL_TEST_TO,
      subject: "Graph app-only smoke test",
      text: "Hello from automated dev/email smoke test.",
    },
    {
      headers: { "x-dev-email-key": DEV_EMAIL_KEY },
    }
  );

  // Your handler returns { status: "ok", result: { ok: true, status: 202 } } typically.
  assert.equal(r?.status, "ok");
  assert.equal(r?.result?.ok, true);
});

test("dev/email smoke: missing key returns 401", async () => {
  // IMPORTANT: don't use getJson/postJson here unless you override expected status
  const res = await fetchJson("/dev/email", {
    method: "POST",
    body: {
      to: DEV_EMAIL_TEST_TO,
      subject: "should fail",
      text: "no key provided",
    },
  });

  assertStatus(res, 401);
  const body = await assertJsonBody(res);
  assert.equal(body?.status, "error");
  assert.equal(body?.message, "Unauthorized");
});