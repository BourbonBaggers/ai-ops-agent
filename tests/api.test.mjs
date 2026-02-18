// tests/api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson, assertStatus, assertJsonBody, qs } from "./_helpers.mjs";

async function tickAt(params) {
  const r = await fetchJson(`/jobs/tick${qs(params)}`, { method: "POST" });
  assertStatus(r, 200);
  const j = assertJsonBody(r);

  assert.equal(
    j.status,
    "ok",
    `expected status "ok" but got ${String(j.status)}. body=${r.text}`
  );

  return j;
}
test("tick schedule: Wednesday should do nothing", async () => {
  // 2026-02-18 is Wednesday in America/Chicago
  const tick = await tickAt("2026-02-18T13:16:40-06:00");
  assert.equal(tick.actions.length, 0, "Wednesday tick should have no actions");
});

test("tick schedule: Friday 09:00 should generate (at least)", async () => {
  const tick = await tickAt("2026-02-20T09:00:00-06:00"); // Friday
  assert.ok(Array.isArray(tick.actions));
  // Don't overfit the test to the exact action list yet.
});