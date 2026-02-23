// tests/admin_assets.test.mjs — pure unit tests, no server or R2 credentials needed.
// The handler is imported directly; env.ASSETS_R2 is a lightweight mock.
import test from "node:test";
import assert from "node:assert/strict";
import { handleAssets } from "../src/routes/assets.js";

const BASE = "https://assets.boozebaggers.com/";
const PREFIX = "Product Pictures/Sized for Websites/";

// ---------------------------------------------------------------------------
// Mock R2 binding
//
// The handler makes three categories of list() calls:
//   1. list({ limit: 10 })            — root sanity check (no prefix)
//   2. list({ prefix, limit: 10 })    — prefix sanity check
//   3. list({ prefix [, cursor] })    — full pagination loop (no limit param)
//
// The mock distinguishes (1)/(2) from (3) by the presence of `limit`.
// Pagination state is tracked via the cursor string "page-N".
// ---------------------------------------------------------------------------

function mockR2(pages) {
  const allKeys = pages.flat();

  return {
    async list({ prefix, cursor, limit } = {}) {
      // Pre-check calls have limit set; return up to limit items without paging.
      if (limit !== undefined) {
        const matching = allKeys
          .filter(k => !prefix || k.startsWith(prefix))
          .slice(0, limit);
        return { objects: matching.map(k => ({ key: k })), truncated: false };
      }

      // Pagination calls: cursor encodes the page index ("page-N"), absent = page 0.
      const pageIdx = cursor ? parseInt(cursor.split("-")[1], 10) : 0;
      const pageKeys = (pages[pageIdx] ?? []).filter(k => !prefix || k.startsWith(prefix));
      const nextIdx = pageIdx + 1;
      const truncated = nextIdx < pages.length;
      return {
        objects: pageKeys.map(k => ({ key: k })),
        truncated,
        cursor: truncated ? `page-${nextIdx}` : undefined,
      };
    },
  };
}

function makeEnv(pages, { baseUrl = BASE, omitR2 = false, omitBase = false } = {}) {
  return {
    ...(omitR2 ? {} : { ASSETS_R2: mockR2(pages) }),
    ...(omitBase ? {} : { ASSET_BASE_URL: baseUrl }),
  };
}

function makeGet(path = "/admin/assets") {
  return new Request(`http://localhost${path}`);
}

function makePost() {
  return new Request("http://localhost/admin/assets", { method: "POST" });
}

async function call(req, env) {
  const res = await handleAssets(req, env);
  const body = await res.json();
  return { status: res.status, body };
}

// ---------------------------------------------------------------------------
// Fixture data — keys use the updated prefix (no leading "assets/")
// ---------------------------------------------------------------------------

const VALID = [
  `${PREFIX}Widget A/front.jpg`,
  `${PREFIX}Widget A/back.JPG`,     // uppercase ext — must be included
  `${PREFIX}Widget A/side.jpeg`,
  `${PREFIX}Widget B/hero.png`,
  `${PREFIX}Widget B/logo.webp`,
  `${PREFIX}Widget C/spin.gif`,
];

const INVALID = [
  `${PREFIX}Widget A/spec-sheet.pdf`,   // wrong type
  `${PREFIX}Widget B/readme.txt`,       // wrong type
  `${PREFIX}root-file.png`,             // no product subdirectory
  `${PREFIX}Widget A/`,                 // directory marker
  `Other Folder/Widget X/sneaky.png`,   // outside allowed prefix
];

const ALL_KEYS = [...VALID, ...INVALID];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("assets: POST returns 405", async () => {
  const { status, body } = await call(makePost(), makeEnv([VALID]));
  assert.equal(status, 405);
  assert.equal(body.status, "error");
});

test("assets: missing ASSETS_R2 binding returns 503", async () => {
  const { status, body } = await call(makeGet(), makeEnv([VALID], { omitR2: true }));
  assert.equal(status, 503);
  assert.equal(body.status, "error");
  assert.match(body.message, /ASSETS_R2/);
});

test("assets: missing ASSET_BASE_URL returns 503", async () => {
  const { status, body } = await call(makeGet(), makeEnv([VALID], { omitBase: true }));
  assert.equal(status, 503);
  assert.equal(body.status, "error");
  assert.match(body.message, /ASSET_BASE_URL/);
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

test("assets: excludes non-image file types", async () => {
  const { body } = await call(makeGet(), makeEnv([ALL_KEYS]));
  assert.equal(body.status, "ok");
  for (const item of body.flat) {
    assert.match(item.key, /\.(jpg|jpeg|png|webp|gif)$/i,
      `unexpected key in results: ${item.key}`);
  }
});

test("assets: excludes files with no product subdirectory", async () => {
  const rootFile = `${PREFIX}stray-image.png`;
  const { body } = await call(makeGet(), makeEnv([[rootFile]]));
  assert.equal(body.count, 0, "file at prefix root with no subdirectory must be excluded");
});

test("assets: excludes directory marker objects", async () => {
  const dirMarker = `${PREFIX}Widget A/`;
  const { body } = await call(makeGet(), makeEnv([[dirMarker]]));
  assert.equal(body.count, 0, "directory markers must be excluded");
});

test("assets: includes .jpg .jpeg .png .webp .gif (case-insensitive)", async () => {
  const mixedCase = [
    `${PREFIX}P/a.JPG`,
    `${PREFIX}P/b.Jpeg`,
    `${PREFIX}P/c.PNG`,
    `${PREFIX}P/d.WebP`,
    `${PREFIX}P/e.GIF`,
  ];
  const { body } = await call(makeGet(), makeEnv([mixedCase]));
  assert.equal(body.count, 5, "all five extensions (any case) must be included");
});

// ---------------------------------------------------------------------------
// Grouping and flat list
// ---------------------------------------------------------------------------

test("assets: groups results by product name", async () => {
  const { body } = await call(makeGet(), makeEnv([VALID]));
  assert.equal(body.status, "ok");

  assert.ok(body.grouped["Widget A"], "Widget A group missing");
  assert.equal(body.grouped["Widget A"].length, 3);

  assert.ok(body.grouped["Widget B"], "Widget B group missing");
  assert.equal(body.grouped["Widget B"].length, 2);

  assert.ok(body.grouped["Widget C"], "Widget C group missing");
  assert.equal(body.grouped["Widget C"].length, 1);
});

test("assets: flat list contains all valid items with productName, key, url", async () => {
  const { body } = await call(makeGet(), makeEnv([VALID]));
  assert.equal(body.flat.length, VALID.length);

  for (const item of body.flat) {
    assert.ok(item.productName, "productName missing");
    assert.ok(item.key, "key missing");
    assert.ok(item.url, "url missing");
  }

  const widgetAItems = body.flat.filter(i => i.productName === "Widget A");
  assert.equal(widgetAItems.length, 3);
});

test("assets: total count matches flat list length", async () => {
  const { body } = await call(makeGet(), makeEnv([ALL_KEYS]));
  assert.equal(body.count, body.flat.length);
  assert.equal(body.count, VALID.length);
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

test("assets: URLs are built as ASSET_BASE_URL + encodeURI(key)", async () => {
  const keyWithSpaces = `${PREFIX}Widget A/photo one.jpg`;
  const { body } = await call(makeGet(), makeEnv([[keyWithSpaces]]));
  assert.equal(body.count, 1);

  const expectedUrl = BASE + encodeURI(keyWithSpaces);
  assert.equal(body.flat[0].url, expectedUrl);

  assert.ok(body.flat[0].url.includes("%20"), "spaces must be percent-encoded");
  assert.ok(!body.flat[0].url.includes(" "), "raw spaces must not appear in URL");
});

test("assets: normalises ASSET_BASE_URL with or without trailing slash", async () => {
  const key = `${PREFIX}Widget A/photo.jpg`;

  const { body: withSlash } = await call(makeGet(), makeEnv([[key]], { baseUrl: BASE }));
  const { body: noSlash  } = await call(makeGet(), makeEnv([[key]], { baseUrl: BASE.slice(0, -1) }));

  assert.equal(withSlash.flat[0].url, noSlash.flat[0].url,
    "trailing slash in base URL must not affect the final URL");
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test("assets: output is sorted deterministically by key", async () => {
  const keys = [...VALID].reverse();
  const { body } = await call(makeGet(), makeEnv([keys]));

  const flatKeys = body.flat.map(i => i.key);
  const sortedKeys = [...flatKeys].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(flatKeys, sortedKeys, "flat list must be sorted by key");
});

test("assets: grouped values are sorted by key within each product", async () => {
  const { body } = await call(makeGet(), makeEnv([VALID]));

  for (const [product, items] of Object.entries(body.grouped)) {
    const keys = items.map(i => i.key);
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(keys, sorted, `${product}: items must be sorted by key`);
  }
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test("assets: pages through multiple R2 list() responses", async () => {
  const page1 = VALID.slice(0, 2);
  const page2 = VALID.slice(2, 4);
  const page3 = VALID.slice(4);

  const { body } = await call(makeGet(), makeEnv([page1, page2, page3]));
  assert.equal(body.count, VALID.length,
    "all items from all pages must be collected");
});

test("assets: handles empty bucket gracefully", async () => {
  const { status, body } = await call(makeGet(), makeEnv([[]]));
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.count, 0);
  assert.deepEqual(body.flat, []);
  assert.deepEqual(body.grouped, {});
});

// ---------------------------------------------------------------------------
// Debug mode
// ---------------------------------------------------------------------------

test("assets: ?debug=1 returns debug response shape", async () => {
  const { status, body } = await call(makeGet("/admin/assets?debug=1"), makeEnv([VALID]));
  assert.equal(status, 200);
  assert.equal(body.status, "debug");
  assert.ok(Array.isArray(body.steps) && body.steps.length > 0, "steps array must be present");
  assert.ok("allowedPrefixRaw" in body, "allowedPrefixRaw missing from debug response");
  assert.ok("allowedPrefixNormalized" in body, "allowedPrefixNormalized missing from debug response");
  assert.ok(Array.isArray(body.rootSample), "rootSample must be present");
  assert.ok(Array.isArray(body.prefixSample), "prefixSample must be present");
  assert.equal(typeof body.count, "number", "count must be present");
  assert.ok(Array.isArray(body.flat), "flat (capped at 25) must be present");
  assert.ok(Array.isArray(body.groupedKeys), "groupedKeys must be present");
});

test("assets: normal request (no debug) returns ok status without debug fields", async () => {
  const { body } = await call(makeGet(), makeEnv([VALID]));
  assert.equal(body.status, "ok");
  assert.equal(body.steps, undefined, "steps must not appear in non-debug response");
  assert.equal(body.allowedPrefixRaw, undefined, "allowedPrefixRaw must not appear in non-debug response");
  assert.ok(Array.isArray(body.flat), "flat must be present");
  assert.ok(typeof body.grouped === "object", "grouped must be present");
});
