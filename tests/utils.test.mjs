// tests/utils.test.mjs — pure unit tests, no server required
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, strOrNull, clampInt, safeJson } from "../src/lib/utils.js";

// --- normalizeEmail ---

test("normalizeEmail: valid emails pass through lowercased", () => {
  assert.equal(normalizeEmail("user@example.com"), "user@example.com");
  assert.equal(normalizeEmail("USER@EXAMPLE.COM"), "user@example.com");
  assert.equal(normalizeEmail("  user@example.com  "), "user@example.com");
});

test("normalizeEmail: rejects missing local part", () => {
  assert.equal(normalizeEmail("@domain.com"), "");
  assert.equal(normalizeEmail("@"), "");
});

test("normalizeEmail: rejects missing domain part", () => {
  assert.equal(normalizeEmail("user@"), "");
});

test("normalizeEmail: rejects multiple @ signs", () => {
  assert.equal(normalizeEmail("user@@domain.com"), "");
  assert.equal(normalizeEmail("a@b@c.com"), "");
});

test("normalizeEmail: rejects empty / null / no @", () => {
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail("notanemail"), "");
});

// --- strOrNull ---

test("strOrNull: returns null for empty / whitespace", () => {
  assert.equal(strOrNull(""), null);
  assert.equal(strOrNull("   "), null);
  assert.equal(strOrNull(null), null);
  assert.equal(strOrNull(undefined), null);
});

test("strOrNull: returns trimmed string for non-empty", () => {
  assert.equal(strOrNull("hello"), "hello");
  assert.equal(strOrNull("  hello  "), "hello");
});

// --- clampInt ---

test("clampInt: value within range passes through", () => {
  assert.equal(clampInt("5", 1, 10, 3), 5);
});

test("clampInt: clamps to min", () => {
  assert.equal(clampInt("0", 1, 10, 3), 1);
});

test("clampInt: clamps to max", () => {
  assert.equal(clampInt("99", 1, 10, 3), 10);
});

test("clampInt: returns default for non-numeric input", () => {
  assert.equal(clampInt("abc", 1, 10, 3), 3);
  assert.equal(clampInt(null, 1, 10, 3), 3);
  assert.equal(clampInt(undefined, 1, 10, 3), 3);
});

// --- safeJson ---

test("safeJson: parses valid JSON", () => {
  assert.deepEqual(safeJson('{"a":1}', {}), { a: 1 });
  assert.deepEqual(safeJson('[1,2,3]', []), [1, 2, 3]);
});

test("safeJson: returns fallback for malformed JSON", () => {
  assert.deepEqual(safeJson("{bad}", {}), {});
  assert.deepEqual(safeJson("", []), []);
  assert.deepEqual(safeJson(null, []), []);
});
