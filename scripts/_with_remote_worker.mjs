/**
 * Lifecycle helper: starts wrangler dev --remote on a side port, waits until
 * /health responds, sets ASSETS_WORKER_URL in the child environment, runs the
 * requested script, then shuts the worker down.
 *
 * Usage (from package.json scripts):
 *   node scripts/_with_remote_worker.mjs scripts/merge_template_preview.mjs [args...]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const REMOTE_PORT = 8789;
const HEALTH_URL = `http://127.0.0.1:${REMOTE_PORT}/health`;
const POLL_INTERVAL_MS = 1000;
const MAX_WAIT_MS = 30_000;

// Everything after this script's own path is passed to the child script
const [, , childScript, ...childArgs] = process.argv;
if (!childScript) {
  console.error("Usage: node scripts/_with_remote_worker.mjs <script> [args...]");
  process.exitCode = 1;
  process.exit();
}

// ── 1. Start wrangler dev --remote ────────────────────────────────────────────
const wrangler = spawn(
  "npx",
  ["wrangler", "dev", "--remote", "--port", String(REMOTE_PORT)],
  { stdio: "inherit" }
);

let exitCode = 0;
try {
  // ── 2. Poll until /health responds ──────────────────────────────────────────
  await waitForHealth();

  // ── 3. Run the child script with ASSETS_WORKER_URL pointing at the remote dev ─
  exitCode = await runScript(childScript, childArgs);
} finally {
  wrangler.kill("SIGTERM");
}

process.exitCode = exitCode;

// ── helpers ───────────────────────────────────────────────────────────────────

async function waitForHealth() {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`wrangler dev --remote did not become ready within ${MAX_WAIT_MS}ms`);
}

function runScript(script, args) {
  return new Promise((resolve) => {
    const child = spawn(
      "node",
      ["--env-file=.dev.vars", script, ...args],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          ASSETS_WORKER_URL: `http://127.0.0.1:${REMOTE_PORT}`,
        },
      }
    );
    child.on("close", (code) => resolve(code ?? 0));
  });
}
