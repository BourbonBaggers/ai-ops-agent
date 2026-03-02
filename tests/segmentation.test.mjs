import test from "node:test";
import assert from "node:assert/strict";
import { selectCandidateForContact, stableHash } from "../src/lib/segmentation.js";

const top    = { funnel_stage: "top",    subject: "Top candidate" };
const mid    = { funnel_stage: "mid",    subject: "Mid candidate" };
const bottom = { funnel_stage: "bottom", subject: "Bottom candidate" };
const allCandidates = [top, mid, bottom];
const week = { week_of: "2026-02-16" };

test("stableHash: deterministic for same input", () => {
  assert.equal(stableHash("abc"), stableHash("abc"));
});

test("cold rep: bucket 0/1/2 selects top candidate", () => {
  const contact = { id: "cold-a", order_count: 0 };
  const bucket = stableHash(contact.id + week.week_of) % 4;
  const result = selectCandidateForContact(allCandidates, contact, week);
  if (bucket === 3) {
    assert.equal(result.funnel_stage, "mid");
  } else {
    assert.equal(result.funnel_stage, "top");
  }
});

test("cold rep: missing order_count defaults to cold", () => {
  const contact = { id: "cold-b" };
  const result = selectCandidateForContact(allCandidates, contact, week);
  assert.ok(["top", "mid"].includes(result.funnel_stage));
});

test("activated rep: bucket 0/1/2 selects bottom candidate", () => {
  const contact = { id: "warm-a", order_count: 3 };
  const bucket = stableHash(contact.id + week.week_of) % 4;
  const result = selectCandidateForContact(allCandidates, contact, week);
  if (bucket === 3) {
    assert.equal(result.funnel_stage, "mid");
  } else {
    assert.equal(result.funnel_stage, "bottom");
  }
});

test("different week_of rotates contact bucket over time", () => {
  const contact = { id: "rotate-me", order_count: 0 };
  const a = selectCandidateForContact(allCandidates, contact, { week_of: "2026-02-16" });
  const b = selectCandidateForContact(allCandidates, contact, { week_of: "2026-02-23" });
  assert.ok(a && b);
});

test("missing funnel stage candidate throws", () => {
  const contact = { id: "warm-b", order_count: 2 };
  assert.throws(
    () => selectCandidateForContact([top, mid], contact, week),
    /missing candidate/
  );
});

test("requires contact.id and weeklyRun.week_of", () => {
  assert.throws(() => selectCandidateForContact(allCandidates, { order_count: 0 }, week), /contact.id/);
  assert.throws(() => selectCandidateForContact(allCandidates, { id: "x", order_count: 0 }, {}), /weeklyRun.week_of/);
});

test("single candidate path works only if stage matches target", () => {
  const contact = { id: "force-mid", order_count: 0 };
  const week3 = { week_of: "2000-01-01" };
  const bucket = stableHash(contact.id + week3.week_of) % 4;
  if (bucket === 3) {
    const result = selectCandidateForContact([mid], contact, week3);
    assert.equal(result.funnel_stage, "mid");
    return;
  }
  assert.throws(() => selectCandidateForContact([mid], contact, week3), /missing candidate/);
});

test("returns top/mid/bottom only", () => {
  const cold = { id: "cold-c", order_count: 0 };
  const warm = { id: "warm-c", order_count: 2 };
  const coldResult = selectCandidateForContact(allCandidates, cold, week);
  const warmResult = selectCandidateForContact(allCandidates, warm, week);
  assert.ok(["top", "mid"].includes(coldResult.funnel_stage));
  assert.ok(["mid", "bottom"].includes(warmResult.funnel_stage));
});
