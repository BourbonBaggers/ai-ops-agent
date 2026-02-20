// tests/settings.test.mjs — pure unit tests, no server required
import test from "node:test";
import assert from "node:assert/strict";
import { loadSettings } from "../src/lib/settings.js";

function env(overrides = {}) {
  return { ...overrides };
}

// --- defaults ---

test("loadSettings: returns defaults when env is empty", () => {
  const s = loadSettings(env());
  assert.equal(s.timezone, "America/Chicago");
  assert.equal(s.schedule.generate.dow, "FRIDAY");
  assert.equal(s.schedule.generate.time, "09:00");
  assert.equal(s.schedule.lock.dow, "TUESDAY");
  assert.equal(s.schedule.lock.time, "09:45");
  assert.equal(s.schedule.send.dow, "TUESDAY");
  assert.equal(s.schedule.send.time, "10:00");
});

test("loadSettings: overrides are applied and uppercased", () => {
  const s = loadSettings(env({
    TIMEZONE: "America/New_York",
    SCHEDULE_GENERATE_DOW: "monday",
    SCHEDULE_GENERATE_TIME: "08:30",
    SCHEDULE_LOCK_DOW: "wednesday",
    SCHEDULE_LOCK_TIME: "11:00",
    SCHEDULE_SEND_DOW: "thursday",
    SCHEDULE_SEND_TIME: "12:00",
  }));

  assert.equal(s.timezone, "America/New_York");
  assert.equal(s.schedule.generate.dow, "MONDAY");
  assert.equal(s.schedule.generate.time, "08:30");
  assert.equal(s.schedule.lock.dow, "WEDNESDAY");
  assert.equal(s.schedule.lock.time, "11:00");
  assert.equal(s.schedule.send.dow, "THURSDAY");
  assert.equal(s.schedule.send.time, "12:00");
});

// --- timezone validation ---

test("loadSettings: throws on invalid TIMEZONE", () => {
  assert.throws(
    () => loadSettings(env({ TIMEZONE: "Not/ATimezone" })),
    /Invalid TIMEZONE/
  );
});

// --- DOW validation ---

test("loadSettings: throws on invalid SCHEDULE_GENERATE_DOW", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_GENERATE_DOW: "SOMEDAY" })),
    /Invalid SCHEDULE_GENERATE_DOW/
  );
});

test("loadSettings: throws on invalid SCHEDULE_LOCK_DOW", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_LOCK_DOW: "Midweek" })),
    /Invalid SCHEDULE_LOCK_DOW/
  );
});

test("loadSettings: throws on invalid SCHEDULE_SEND_DOW", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_SEND_DOW: "9" })),
    /Invalid SCHEDULE_SEND_DOW/
  );
});

// --- time format validation ---

test("loadSettings: throws on missing colon in SCHEDULE_GENERATE_TIME", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_GENERATE_TIME: "0900" })),
    /Invalid SCHEDULE_GENERATE_TIME/
  );
});

test("loadSettings: throws on out-of-range hour in SCHEDULE_LOCK_TIME", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_LOCK_TIME: "25:00" })),
    /Invalid SCHEDULE_LOCK_TIME/
  );
});

test("loadSettings: throws on out-of-range minute in SCHEDULE_SEND_TIME", () => {
  assert.throws(
    () => loadSettings(env({ SCHEDULE_SEND_TIME: "10:60" })),
    /Invalid SCHEDULE_SEND_TIME/
  );
});

// --- mail fields (optional, no validation) ---

test("loadSettings: mail fields default to empty string", () => {
  const s = loadSettings(env());
  assert.equal(s.mail.senderMailbox, "");
  assert.equal(s.mail.replyTo, "");
});

test("loadSettings: mail fields are populated from env", () => {
  const s = loadSettings(env({
    MAIL_SENDER_UPN: "sender@example.com",
    REPLY_TO: "reply@example.com",
  }));
  assert.equal(s.mail.senderMailbox, "sender@example.com");
  assert.equal(s.mail.replyTo, "reply@example.com");
});
