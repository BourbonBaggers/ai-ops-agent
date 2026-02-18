import { handleHealth } from "./routes/health.js";
import { handleContacts } from "./routes/contacts.js";
import { handlePolicy } from "./routes/policy.js";
import { handleConfig } from "./routes/config.js";
import { handleJobs } from "./routes/jobs.js";
import { handleCalendar } from "./routes/calendar.js";
import { handleCandidates } from "./routes/candidates.js";
import { handleWeekly } from "./routes/weekly.js";
import { handleDev } from "./routes/dev.js";
import { handleAdminSends } from "./routes/admin_sends.js";


export async function handleRequest(request, env) {
  const url = new URL(request.url);
  console.log("ROUTER VERSION", "2026-02-17a", "handleHealth type:", typeof handleHealth);

  const devResp = await handleDev(request, env);
  if (devResp) return devResp;

  if (url.pathname === "/admin/sends" && request.method === "GET") {
    return handleAdminSends(request, env);
  }

  if (url.pathname === "/health") {
    return handleHealth(request, env);
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

  if (url.pathname.startsWith("/admin/weekly")) {
    return handleWeekly(request, env);
  }



  return new Response("ai-ops-agent running (router 2026-02-17a)");
}