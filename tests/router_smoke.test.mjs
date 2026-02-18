// tests/router_smoke.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fetchJson } from "./_helpers.mjs";

/**
 * Extracts likely route paths from src/router.js.
 * Not perfect, but good enough to prevent silent breakage.
 */
function extractRoutesFromRouter(routerSource) {
  const paths = new Set();

  // Exact matches: pathname === "/x"
  for (const m of routerSource.matchAll(/pathname\s*===\s*["'`](\/[^"'`]+)["'`]/g)) {
    paths.add(m[1]);
  }

  // Prefix matches: pathname.startsWith("/x")
  for (const m of routerSource.matchAll(/pathname\.startsWith\(\s*["'`](\/[^"'`]+)["'`]\s*\)/g)) {
    paths.add(m[1]);
  }

  // Filter obvious junk
  return [...paths].filter(p => p !== "/").sort();
}

async function tryMethod(routePath, method) {
  const opts = { method };

  if (method === "POST") {
    opts.headers = { "content-type": "application/json" };
    opts.body = JSON.stringify({});
  }

  const r = await fetchJson(routePath, opts);
  return r;
}

function isOkNon404Non500(res) {
  return res.status !== 404 && res.status !== 500;
}

test("router smoke: every route in src/router.js responds (non-404) and does not 500", async () => {
  const routerPath = path.resolve(process.cwd(), "src/router.js");
  const src = fs.readFileSync(routerPath, "utf8");

  const routes = extractRoutesFromRouter(src);

  // Sanity check so this test doesn't silently do nothing.
  assert.ok(routes.length > 0, "No routes detected in src/router.js. Regex too strict?");

  const failures = [];

  for (const p of routes) {
    // Try GET then POST. Many endpoints are POST-only; some are GET-only.
    const getR = await tryMethod(p, "GET");
    const postR = await tryMethod(p, "POST");

    const ok =
      isOkNon404Non500(getR.res) || isOkNon404Non500(postR.res);

    if (!ok) {
      failures.push({
        path: p,
        get: { status: getR.res.status, body: getR.text },
        post: { status: postR.res.status, body: postR.text },
      });
    }
  }

  if (failures.length) {
    const msg = failures
      .map(
        (f) =>
          `${f.path}\n  GET  ${f.get.status} body=${JSON.stringify(f.get.body).slice(0, 300)}\n  POST ${f.post.status} body=${JSON.stringify(f.post.body).slice(0, 300)}`
      )
      .join("\n\n");

    assert.fail(`Router smoke failures:\n\n${msg}`);
  }
});