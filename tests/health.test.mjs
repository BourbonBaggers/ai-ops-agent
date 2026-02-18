// tests/health.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { getJson } from "./_helpers.mjs";

test("health endpoint works", async () => {
  const body = await getJson("/health");
  assert.equal(body.status, "ok");
  assert.equal(body.db, true);
});

test("dev ping returns timezone + week", async () => {
  const body = await getJson("/dev/ping");
  assert.equal(body.status, "ok");
  assert.ok(body.tz, "expected tz");
  assert.ok(body.week_of, "expected week_of");
});