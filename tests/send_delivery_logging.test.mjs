import test from "node:test";
import assert from "node:assert/strict";
import { sendWeeklyRun } from "../src/routes/jobs.js";

test("sendWeeklyRun writes send_deliveries and run_log with idempotent rerun", async () => {
  const db = new MockD1({
    weekly_runs: [
      {
        id: "run-1",
        week_of: "2026-02-16",
        locked_at: "2026-02-16T00:00:00.000Z",
        selected_candidate_id: "cand-top",
        status: "locked",
      },
    ],
    candidates: [
      {
        id: "cand-top",
        weekly_run_id: "run-1",
        rank: 1,
        funnel_stage: "top",
        subject: "Top Subject",
        preview_text: "Top preview",
        body_markdown: "Top body",
        body_html: "<p>Top body</p>",
        body_text: "Top body",
      },
      {
        id: "cand-mid",
        weekly_run_id: "run-1",
        rank: 2,
        funnel_stage: "mid",
        subject: "Mid Subject",
        preview_text: "Mid preview",
        body_markdown: "Mid body",
        body_html: "<p>Mid body</p>",
        body_text: "Mid body",
      },
      {
        id: "cand-bottom",
        weekly_run_id: "run-1",
        rank: 3,
        funnel_stage: "bottom",
        subject: "Bottom Subject",
        preview_text: "Bottom preview",
        body_markdown: "Bottom body",
        body_html: "<p>Bottom body</p>",
        body_text: "Bottom body",
      },
    ],
    contacts: [
      { id: "c1", email: "c1@example.com", order_count: 0, status: "active" },
      { id: "c2", email: "c2@example.com", order_count: 0, status: "active" },
      { id: "c3", email: "c3@example.com", order_count: 5, status: "active" },
      { id: "c4", email: "c4@example.com", order_count: 7, status: "active" },
    ],
  });

  let graphCalls = 0;
  const env = {
    DB: db,
    ENVIRONMENT: "dev",
    GRAPH_SENDER_EMAIL: "sender@example.com",
    REPLY_TO: "reply@example.com",
    GRAPH_SEND_IMPL: async () => {
      graphCalls++;
      return { status: 202 };
    },
  };

  const run = db.tables.weekly_runs[0];
  const didSendFirst = await sendWeeklyRun(env, run, "2026-02-16T10:00:00.000Z");
  assert.equal(didSendFirst, true);
  assert.equal(graphCalls, 4);
  assert.equal(db.tables.send_deliveries.length, 4);
  assert.ok(db.tables.send_deliveries.every((d) => d.status === "sent"));

  const usedCandidateIds = new Set(db.tables.send_deliveries.map((d) => d.candidate_id));
  assert.equal(db.tables.sends.length, usedCandidateIds.size);

  assert.equal(db.tables.run_log.length, 1);
  const log1 = db.tables.run_log[0];
  assert.equal(log1.contacts_total, 4);
  assert.equal(log1.attempted, 4);
  assert.equal(log1.sent_success, 4);
  assert.equal(log1.failed, 0);
  assert.equal(log1.dry_run_count, 0);
  assert.equal(log1.skipped_already_sent, 0);

  const didSendSecond = await sendWeeklyRun(env, run, "2026-02-16T10:00:00.000Z");
  assert.equal(didSendSecond, false);
  assert.equal(graphCalls, 4);
  assert.equal(db.tables.send_deliveries.length, 4);
  assert.equal(db.tables.run_log.length, 2);

  const log2 = db.tables.run_log[1];
  assert.equal(log2.contacts_total, 4);
  assert.equal(log2.attempted, 0);
  assert.equal(log2.sent_success, 0);
  assert.equal(log2.failed, 0);
  assert.equal(log2.dry_run_count, 0);
  assert.equal(log2.skipped_already_sent, 4);
});

test("sendWeeklyRun dry run writes dry_run deliveries and skips graph", async () => {
  const db = new MockD1({
    weekly_runs: [
      {
        id: "run-2",
        week_of: "2026-02-23",
        locked_at: "2026-02-23T00:00:00.000Z",
        selected_candidate_id: "cand-top2",
        status: "locked",
      },
    ],
    candidates: [
      {
        id: "cand-top2",
        weekly_run_id: "run-2",
        rank: 1,
        funnel_stage: "top",
        subject: "Top Subject",
        preview_text: "Top preview",
        body_markdown: "Top body",
        body_html: "<p>Top body</p>",
        body_text: "Top body",
      },
      {
        id: "cand-mid2",
        weekly_run_id: "run-2",
        rank: 2,
        funnel_stage: "mid",
        subject: "Mid Subject",
        preview_text: "Mid preview",
        body_markdown: "Mid body",
        body_html: "<p>Mid body</p>",
        body_text: "Mid body",
      },
      {
        id: "cand-bottom2",
        weekly_run_id: "run-2",
        rank: 3,
        funnel_stage: "bottom",
        subject: "Bottom Subject",
        preview_text: "Bottom preview",
        body_markdown: "Bottom body",
        body_html: "<p>Bottom body</p>",
        body_text: "Bottom body",
      },
    ],
    contacts: [
      { id: "d1", email: "d1@example.com", order_count: 0, status: "active" },
      { id: "d2", email: "d2@example.com", order_count: 0, status: "active" },
      { id: "d3", email: "d3@example.com", order_count: 3, status: "active" },
      { id: "d4", email: "d4@example.com", order_count: 4, status: "active" },
    ],
  });

  let graphCalls = 0;
  const env = {
    DB: db,
    ENVIRONMENT: "dev",
    DRY_RUN: "true",
    GRAPH_SENDER_EMAIL: "sender@example.com",
    REPLY_TO: "reply@example.com",
    GRAPH_SEND_IMPL: async () => {
      graphCalls++;
      return { status: 202 };
    },
  };

  const run = db.tables.weekly_runs[0];
  const first = await sendWeeklyRun(env, run, "2026-02-23T10:00:00.000Z");
  assert.equal(first, false);
  assert.equal(graphCalls, 0);
  assert.equal(db.tables.send_deliveries.length, 4);
  assert.ok(db.tables.send_deliveries.every((d) => d.status === "dry_run"));
  assert.equal(db.tables.run_log.length, 1);
  assert.equal(db.tables.run_log[0].dry_run, 1);
  assert.equal(db.tables.run_log[0].dry_run_count, 4);
  assert.equal(db.tables.run_log[0].attempted, 4);
  assert.equal(db.tables.run_log[0].sent_success, 0);
  assert.equal(db.tables.run_log[0].failed, 0);

  const second = await sendWeeklyRun(env, run, "2026-02-23T10:00:00.000Z");
  assert.equal(second, false);
  assert.equal(graphCalls, 0);
  assert.equal(db.tables.send_deliveries.length, 4);
  assert.equal(db.tables.run_log.length, 2);
  assert.equal(db.tables.run_log[1].dry_run, 1);
  assert.equal(db.tables.run_log[1].dry_run_count, 0);
  assert.equal(db.tables.run_log[1].attempted, 0);
  assert.equal(db.tables.run_log[1].skipped_already_sent, 4);
});

class MockD1 {
  constructor(seed = {}) {
    this.tables = {
      weekly_runs: seed.weekly_runs ? seed.weekly_runs.map(clone) : [],
      candidates: seed.candidates ? seed.candidates.map(clone) : [],
      contacts: seed.contacts ? seed.contacts.map(clone) : [],
      sends: seed.sends ? seed.sends.map(clone) : [],
      send_deliveries: seed.send_deliveries ? seed.send_deliveries.map(clone) : [],
      run_log: seed.run_log ? seed.run_log.map(clone) : [],
    };
  }

  prepare(sql) {
    return new MockStmt(this, sql);
  }
}

class MockStmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const q = normalize(this.sql);
    const t = this.db.tables;

    if (q.includes("SELECT * FROM WEEKLY_RUNS WHERE ID = ?")) {
      return t.weekly_runs.find((r) => r.id === this.args[0]) || null;
    }
    if (q.includes("SELECT ID, CANDIDATE_ID FROM SENDS WHERE WEEKLY_RUN_ID = ? AND CANDIDATE_ID = ? LIMIT 1")) {
      return t.sends.find((s) => s.weekly_run_id === this.args[0] && s.candidate_id === this.args[1]) || null;
    }
    if (q.includes("SELECT ID, STATUS FROM SEND_DELIVERIES WHERE SEND_ID = ? AND CONTACT_ID = ? LIMIT 1")) {
      return t.send_deliveries.find((d) => d.send_id === this.args[0] && d.contact_id === this.args[1]) || null;
    }
    if (q.includes("SELECT ID FROM CANDIDATES WHERE WEEKLY_RUN_ID = ? AND RANK = 1 LIMIT 1")) {
      const row = t.candidates.find((c) => c.weekly_run_id === this.args[0] && c.rank === 1);
      return row ? { id: row.id } : null;
    }

    throw new Error(`Unsupported first SQL: ${this.sql}`);
  }

  async all() {
    const q = normalize(this.sql);
    const t = this.db.tables;

    if (q.includes("SELECT ID, FUNNEL_STAGE, SUBJECT, PREVIEW_TEXT, BODY_MARKDOWN, BODY_HTML, BODY_TEXT FROM CANDIDATES WHERE WEEKLY_RUN_ID = ? ORDER BY RANK ASC")) {
      const weeklyRunId = this.args[0];
      const results = t.candidates
        .filter((c) => c.weekly_run_id === weeklyRunId)
        .sort((a, b) => a.rank - b.rank)
        .map((c) => ({
          id: c.id,
          funnel_stage: c.funnel_stage,
          subject: c.subject,
          preview_text: c.preview_text,
          body_markdown: c.body_markdown,
          body_html: c.body_html,
          body_text: c.body_text,
        }));
      return { results };
    }
    if (q.includes("SELECT ID, EMAIL, ORDER_COUNT FROM CONTACTS WHERE STATUS = 'ACTIVE' ORDER BY ID")) {
      const results = t.contacts
        .filter((c) => c.status === "active")
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((c) => ({ id: c.id, email: c.email, order_count: c.order_count }));
      return { results };
    }
    if (q.includes("SELECT ID, CANDIDATE_ID FROM SENDS WHERE WEEKLY_RUN_ID = ?")) {
      const weeklyRunId = this.args[0];
      return { results: t.sends.filter((s) => s.weekly_run_id === weeklyRunId).map((s) => ({ id: s.id, candidate_id: s.candidate_id })) };
    }

    throw new Error(`Unsupported all SQL: ${this.sql}`);
  }

  async run() {
    const q = normalize(this.sql);
    const t = this.db.tables;

    if (q.startsWith("INSERT OR IGNORE INTO SENDS")) {
      const [id, weekly_run_id, candidate_id, subject, preview_text, body_html, body_text, sender_mailbox, reply_to, tracking_salt, created_at] = this.args;
      const exists = t.sends.find((s) => s.weekly_run_id === weekly_run_id && s.candidate_id === candidate_id);
      if (exists) return { meta: { changes: 0 } };
      t.sends.push({ id, weekly_run_id, candidate_id, subject, preview_text, body_html, body_text, sender_mailbox, reply_to, tracking_salt, created_at });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith("INSERT INTO SEND_DELIVERIES")) {
      const [id, send_id, weekly_run_id, candidate_id, contact_id, recipient_email, funnel_stage, created_at] = this.args;
      const exists = t.send_deliveries.find((d) => d.send_id === send_id && d.contact_id === contact_id);
      if (exists) throw new Error("UNIQUE constraint failed: send_deliveries.send_id, send_deliveries.contact_id");
      t.send_deliveries.push({
        id, send_id, weekly_run_id, candidate_id, contact_id, recipient_email, funnel_stage,
        status: "pending", graph_status: null, error: null, created_at,
      });
      return { meta: { changes: 1 } };
    }
    if (q.startsWith("UPDATE SEND_DELIVERIES SET STATUS = 'SENT'")) {
      const [graph_status, id] = this.args;
      const row = t.send_deliveries.find((d) => d.id === id);
      if (row) {
        row.status = "sent";
        row.graph_status = graph_status;
        row.error = null;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (q.startsWith("UPDATE SEND_DELIVERIES SET STATUS = 'DRY_RUN'")) {
      const [id] = this.args;
      const row = t.send_deliveries.find((d) => d.id === id);
      if (row) {
        row.status = "dry_run";
        row.graph_status = null;
        row.error = null;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (q.startsWith("UPDATE SEND_DELIVERIES SET STATUS = 'FAILED'")) {
      const [error, id] = this.args;
      const row = t.send_deliveries.find((d) => d.id === id);
      if (row) {
        row.status = "failed";
        row.graph_status = null;
        row.error = error;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (q.startsWith("UPDATE WEEKLY_RUNS SET SELECTED_CANDIDATE_ID = ?")) {
      const [selected_candidate_id, updated_at, id] = this.args;
      const row = t.weekly_runs.find((r) => r.id === id);
      if (row) {
        row.selected_candidate_id = selected_candidate_id;
        row.updated_at = updated_at;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (q.startsWith("UPDATE WEEKLY_RUNS SET SENT_AT = ?, STATUS = 'SENT', UPDATED_AT = ? WHERE ID = ?")) {
      const [sent_at, updated_at, id] = this.args;
      const row = t.weekly_runs.find((r) => r.id === id);
      if (row) {
        row.sent_at = sent_at;
        row.status = "sent";
        row.updated_at = updated_at;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }
    if (q.startsWith("INSERT INTO RUN_LOG")) {
      const [
        id,
        weekly_run_id,
        started_at,
        finished_at,
        dry_run,
        contacts_total,
        attempted,
        sent_success,
        failed,
        skipped_already_sent,
        dry_run_count,
        top_count,
        mid_count,
        bottom_count,
        error_rollup_json,
        sample_json,
      ] = this.args;
      t.run_log.push({
        id,
        weekly_run_id,
        started_at,
        finished_at,
        dry_run,
        contacts_total,
        attempted,
        sent_success,
        failed,
        skipped_already_sent,
        dry_run_count,
        top_count,
        mid_count,
        bottom_count,
        error_rollup_json,
        sample_json,
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported run SQL: ${this.sql}`);
  }
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toUpperCase();
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
