// tests/csv.test.mjs — pure unit tests, no server required
import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, mapContactRow, csvEscape } from "../src/lib/csv.js";

// --- parseCsv ---

test("parseCsv: basic two-column CSV", () => {
  const rows = parseCsv("First Name,Last Name\nAlice,Smith\nBob,Jones");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { "First Name": "Alice", "Last Name": "Smith" });
  assert.deepEqual(rows[1], { "First Name": "Bob", "Last Name": "Jones" });
});

test("parseCsv: quoted field containing a comma", () => {
  const rows = parseCsv('Name,Address\nAlice,"123 Main St, Apt 4"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Address"], "123 Main St, Apt 4");
});

test("parseCsv: escaped double-quote inside quoted field", () => {
  const rows = parseCsv('Name,Quote\nAlice,"She said ""hello"""');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Quote"], 'She said "hello"');
});

test("parseCsv: CRLF line endings are handled", () => {
  const rows = parseCsv("First Name,Last Name\r\nAlice,Smith\r\nBob,Jones");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["First Name"], "Alice");
  assert.equal(rows[1]["First Name"], "Bob");
});

test("parseCsv: trailing blank lines are dropped", () => {
  const rows = parseCsv("Name,Email\nAlice,a@b.com\n\n");
  assert.equal(rows.length, 1);
});

test("parseCsv: empty input returns empty array", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\n\n"), []);
});

test("parseCsv: header-only returns empty array", () => {
  assert.deepEqual(parseCsv("Name,Email"), []);
});

// --- mapContactRow ---

test("mapContactRow: maps standard header names", () => {
  const row = {
    "First Name": "Alice",
    "Last Name": "Smith",
    "Email": "alice@example.com",
    "Phone Number": "555-1234",
    "Address Line 1": "123 Main",
    "Address Line 2": "Apt 4",
    "City": "Springfield",
    "State": "IL",
    "Zip": "62701",
    "Rep Group": "A",
    "Status": "Active",
  };
  const c = mapContactRow(row);
  assert.equal(c.firstname, "Alice");
  assert.equal(c.lastname, "Smith");
  assert.equal(c.email, "alice@example.com");
  assert.equal(c.phone, "555-1234");
  assert.equal(c.address_line1, "123 Main");
  assert.equal(c.address_line2, "Apt 4");
  assert.equal(c.city, "Springfield");
  assert.equal(c.state, "IL");
  assert.equal(c.zip, "62701");
  assert.equal(c.contact_group, "A");
  assert.equal(c.status, "active"); // lowercased
});

test("mapContactRow: status defaults to 'active' when missing", () => {
  const c = mapContactRow({ "First Name": "Bob" });
  assert.equal(c.status, "active");
});

test("mapContactRow: accepts alternate header casing (case-insensitive match)", () => {
  const c = mapContactRow({ "first name": "Charlie", "EMAIL": "c@x.com" });
  assert.equal(c.firstname, "Charlie");
  assert.equal(c.email, "c@x.com");
});

test("mapContactRow: order_count defaults to 0 when missing", () => {
  const c = mapContactRow({ "First Name": "Bob" });
  assert.equal(c.order_count, 0);
});

test("mapContactRow: order_count parsed from 'Order Count' column", () => {
  const c = mapContactRow({ "First Name": "Alice", "Order Count": "5" });
  assert.equal(c.order_count, 5);
});

test("mapContactRow: order_count clamped to 0 for invalid/negative values", () => {
  const c1 = mapContactRow({ "Order Count": "not-a-number" });
  assert.equal(c1.order_count, 0);
  const c2 = mapContactRow({ "order_count": "-3" });
  assert.equal(c2.order_count, 0);
});

// --- csvEscape ---

test("csvEscape: plain value passes through unchanged", () => {
  assert.equal(csvEscape("hello"), "hello");
  assert.equal(csvEscape("123"), "123");
});

test("csvEscape: value with comma is quoted", () => {
  assert.equal(csvEscape("a,b"), '"a,b"');
});

test("csvEscape: value with double-quote has inner quotes doubled", () => {
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
});

test("csvEscape: value with newline is quoted", () => {
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
});

test("csvEscape: null and undefined return empty string", () => {
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
});

test("csvEscape: round-trip: escape then parse recovers original", () => {
  const original = 'She said "hello, world"\nSecond line';
  const escaped = csvEscape(original);
  const rows = parseCsv(`Value\n${escaped}`);
  assert.equal(rows[0]["Value"], original);
});
