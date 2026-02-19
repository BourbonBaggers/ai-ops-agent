// tests/admin_endpoints.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { fetchJson, assertStatus, assertJsonBody, getJson, qs } from "./_helpers.mjs";

async function getWeekOf() {
  const ping = await getJson("/dev/ping");
  assert.equal(ping.status, "ok");
  assert.ok(ping.week_of, "dev/ping did not return week_of");
  return ping.week_of;
}

test("admin/config GET returns ok", async () => {
  const r = await fetchJson("/admin/config");
  assertStatus(r, 200);
  const j = assertJsonBody(r);
  assert.equal(j.status, "ok");
  // Don't overfit the shape, just make sure it's not nonsense.
  assert.ok(j.config || j.settings || j.timezone || j.schedule, "config payload missing expected fields");
});

test("admin/policy GET returns ok", async () => {
  const r = await fetchJson("/admin/policy");
  assertStatus(r, 200);
  const j = assertJsonBody(r);
  assert.equal(j.status, "ok");
});

test("admin/policy POST with empty body returns 400 (not 500)", async () => {
  const r = await fetchJson("/admin/policy", { method: "POST", body: {} });
  // we *want* validation here, not a server crash
  assertStatus(r, 400);
  // body should still be JSON from your jsonError wrapper
  assertJsonBody(r);
});

test("admin/contacts GET returns ok", async () => {
  const r = await fetchJson("/admin/contacts");
  assertStatus(r, 200);
  const j = assertJsonBody(r);
  assert.equal(j.status, "ok");
});

test("admin/contacts POST with empty body returns 400 (not 500)", async () => {
  const r = await fetchJson("/admin/contacts", { method: "POST", body: {} });
  assertStatus(r, 400);
  assertJsonBody(r);
});

test("admin/candidates requires week_of: missing => 400, with week_of => 200", async () => {
  // missing query should be a clean 400
  {
    const r = await fetchJson("/admin/candidates");
    assertStatus(r, 400);
    assertJsonBody(r);
  }

  const week_of = await getWeekOf();
  {
    const r = await fetchJson(`/admin/candidates${qs({ week_of })}`);
    assertStatus(r, 200);
    const j = assertJsonBody(r);
    assert.equal(j.status, "ok");
    assert.equal(j.week_of, week_of);
  }
});

test("admin/calendar requires from/to: missing => 400, with from/to => 200", async () => {
  // missing query should be a clean 400
  {
    const r = await fetchJson("/admin/calendar");
    assertStatus(r, 400);
    assertJsonBody(r);
  }

  // Use week_of just to derive a valid [from,to] range for the test
  const week_of = await getWeekOf(); // YYYY-MM-DD (your system’s “week start”)
  const from = week_of;

  // Compute `to` = from + 6 days (inclusive week window)
  const d0 = new Date(`${from}T00:00:00.000Z`);
  const d6 = new Date(d0.getTime() + 6 * 24 * 60 * 60 * 1000);
  const to = d6.toISOString().slice(0, 10); // YYYY-MM-DD

  {
    const r = await fetchJson(`/admin/calendar${qs({ from, to })}`);
    assertStatus(r, 200);
    const j = assertJsonBody(r);
    assert.equal(j.status, "ok");

    // Don’t overfit. Assert it echoes something meaningful.
    assert.ok(j.from || j.start || j.range?.from, "calendar response missing from/start");
    assert.ok(j.to || j.end || j.range?.to, "calendar response missing to/end");
  }
});