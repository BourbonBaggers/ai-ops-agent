import test from "node:test";
import assert from "node:assert/strict";
import { handleEmailImages } from "../src/routes/email_images.js";

test("email_images upload fully overwrites table", async () => {
  const env = { DB: new MockD1() };

  const csvA = [
    "url,alt,description,product_name",
    "https://assets.example.com/a1.jpg,Alt A1,Desc A1,Alpha",
    "https://assets.example.com/a2.jpg,Alt A2,Desc A2,Alpha",
  ].join("\n");

  const uploadA = await call(
    new Request("http://localhost/admin/email_images/upload", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csvA,
    }),
    env
  );
  assert.equal(uploadA.status, 200);
  assert.equal(uploadA.body.status, "ok");
  assert.equal(uploadA.body.rows_inserted, 2);

  const listA = await call(new Request("http://localhost/admin/email_images?limit=100"), env);
  assert.equal(listA.status, 200);
  assert.equal(listA.body.count, 2);

  const csvB = [
    "url,alt,description,product_name",
    "https://assets.example.com/b1.jpg,Alt B1,Desc B1,Beta",
  ].join("\n");

  const uploadB = await call(
    new Request("http://localhost/admin/email_images/upload", {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: csvB,
    }),
    env
  );
  assert.equal(uploadB.status, 200);
  assert.equal(uploadB.body.rows_inserted, 1);

  const listB = await call(new Request("http://localhost/admin/email_images?limit=100"), env);
  assert.equal(listB.status, 200);
  assert.equal(listB.body.count, 1);
  assert.equal(listB.body.rows[0].url, "https://assets.example.com/b1.jpg");
  assert.equal(listB.body.rows[0].product_name, "Beta");
});

async function call(request, env) {
  const res = await handleEmailImages(request, env);
  const body = await res.json();
  return { status: res.status, body };
}

class MockD1 {
  constructor() {
    this.rows = [];
    this.snapshot = null;
  }

  prepare(sql) {
    return new MockStmt(this, sql);
  }

  async batch(stmts) {
    const out = [];
    for (const stmt of stmts) {
      out.push(await stmt.run());
    }
    return out;
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

  async run() {
    const q = normalize(this.sql);

    if (q.startsWith("BEGIN IMMEDIATE")) {
      this.db.snapshot = this.db.rows.map((r) => ({ ...r }));
      return { meta: { changes: 0 } };
    }
    if (q.startsWith("COMMIT")) {
      this.db.snapshot = null;
      return { meta: { changes: 0 } };
    }
    if (q.startsWith("ROLLBACK")) {
      if (this.db.snapshot) this.db.rows = this.db.snapshot.map((r) => ({ ...r }));
      this.db.snapshot = null;
      return { meta: { changes: 0 } };
    }
    if (q.startsWith("DELETE FROM EMAIL_IMAGES")) {
      const changes = this.db.rows.length;
      this.db.rows = [];
      return { meta: { changes } };
    }
    if (q.startsWith("INSERT INTO EMAIL_IMAGES")) {
      const [url, alt, description, product_name] = this.args;
      this.db.rows.push({
        id: this.db.rows.length + 1,
        url,
        alt,
        description,
        product_name: product_name ?? null,
        created_at: "now",
        updated_at: "now",
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported SQL in run(): ${this.sql}`);
  }

  async all() {
    const q = normalize(this.sql);
    if (!q.includes("FROM EMAIL_IMAGES")) {
      throw new Error(`Unsupported SQL in all(): ${this.sql}`);
    }

    const hasProductFilter = q.includes("WHERE PRODUCT_NAME = ?");
    const limit = Number(this.args[hasProductFilter ? 1 : 0] ?? 200);
    const product = hasProductFilter ? this.args[0] : null;
    let results = this.db.rows.map((r) => ({ ...r }));
    if (product) results = results.filter((r) => r.product_name === product);
    results.sort((a, b) => {
      const pa = a.product_name || "";
      const pb = b.product_name || "";
      if (pa !== pb) return pa.localeCompare(pb);
      return a.url.localeCompare(b.url);
    });

    return { results: results.slice(0, limit) };
  }
}

function normalize(sql) {
  return String(sql).replace(/\s+/g, " ").trim().toUpperCase();
}
