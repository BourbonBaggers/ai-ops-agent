import { handleHealth } from "./routes/health.js";
import { handleDebug } from "./routes/debug.js";
import { handleSeed } from "./routes/seed.js";
import { handleContacts } from "./routes/contacts.js";
import { handlePolicy } from "./routes/policy.js";
import { handleConfig } from "./routes/config.js";
import { handleJobs } from "./routes/jobs.js";
import { handleCalendar } from "./routes/calendar.js";
import { handleCandidates } from "./routes/candidates.js";


export async function handleRequest(request, env) {
  const url = new URL(request.url);
  console.log("ROUTER VERSION", "2026-02-17a", "handleHealth type:", typeof handleHealth);

  if (url.pathname === "/health") {
    return handleHealth(request, env);
  }

  if (url.pathname === "/debug/whereami") {
    return handleDebug(request, env);
  }

  if (url.pathname === "/admin/seed") {
    return handleSeed(request, env);
  }

  if (url.pathname.startsWith("/admin/contacts")) {
    return handleContacts(request, env);
  }

  if (url.pathname.startsWith("/admin/policy")) {
    return handlePolicy(request, env);
  }

  if (url.pathname.startsWith("/admin/config")) {
  return handleConfig(request, env);
  }

  if (url.pathname.startsWith("/jobs/")) {
    return handleJobs(request, env);
  }

  if (url.pathname.startsWith("/admin/calendar")) {
    return handleCalendar(request, env);
  }

  if (url.pathname.startsWith("/admin/candidates")) {
    return handleCandidates(request, env);
  }

  return new Response("ai-ops-agent running (router 2026-02-17a)");
}