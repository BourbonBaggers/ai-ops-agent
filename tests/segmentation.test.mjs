import test from "node:test";
import assert from "node:assert/strict";
import { selectCandidateForContact } from "../src/lib/segmentation.js";

const top    = { funnel_stage: "top",    subject: "Top candidate" };
const mid    = { funnel_stage: "mid",    subject: "Mid candidate" };
const bottom = { funnel_stage: "bottom", subject: "Bottom candidate" };
const allCandidates = [top, mid, bottom];

// --- Cold rep (order_count === 0) ---

test("cold rep: r < 0.8 selects top candidate", () => {
  const contact = { order_count: 0 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.5);
  assert.equal(result.funnel_stage, "top");
});

test("cold rep: r >= 0.8 selects mid candidate", () => {
  const contact = { order_count: 0 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.9);
  assert.equal(result.funnel_stage, "mid");
});

test("cold rep: missing order_count defaults to cold (top/mid pool)", () => {
  const contact = {};  // no order_count field
  const result = selectCandidateForContact(contact, allCandidates, () => 0.1);
  assert.equal(result.funnel_stage, "top");
});

// --- Activated rep (order_count > 0) ---

test("activated rep: r < 0.5 selects mid candidate", () => {
  const contact = { order_count: 3 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.3);
  assert.equal(result.funnel_stage, "mid");
});

test("activated rep: r >= 0.5 selects bottom candidate", () => {
  const contact = { order_count: 1 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.7);
  assert.equal(result.funnel_stage, "bottom");
});

// --- Boundary / edge cases ---

test("boundary: order_count exactly 0 is cold", () => {
  const contact = { order_count: 0 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.0);
  assert.equal(result.funnel_stage, "top");
});

test("boundary: order_count exactly 1 is activated", () => {
  const contact = { order_count: 1 };
  const result = selectCandidateForContact(contact, allCandidates, () => 0.0);
  assert.equal(result.funnel_stage, "mid");
});

test("missing funnel stage candidates: returns best available fallback", () => {
  const contact = { order_count: 0 };
  // Only mid + bottom available — cold rep at r=0.5 (>=0.8 threshold picks mid)
  const result = selectCandidateForContact(contact, [mid, bottom], () => 0.9);
  assert.equal(result.funnel_stage, "mid");
});

test("single candidate: always returns it regardless of contact", () => {
  const cold = { order_count: 0 };
  const active = { order_count: 5 };
  assert.equal(selectCandidateForContact(cold, [mid], () => 0.5)?.funnel_stage, "mid");
  assert.equal(selectCandidateForContact(active, [mid], () => 0.5)?.funnel_stage, "mid");
});
