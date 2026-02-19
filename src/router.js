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
import { json } from "./lib/utils.js";
import { handleDevEmail } from "./routes/dev_email.js";

export async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);
    const { pathname } = url;

    console.log(
      "ROUTER VERSION",
      "2026-02-17a",
      "handleHealth type:",
      typeof handleHealth
    );

    // Dev routes (e.g., /dev/ping, /dev/run). This handler decides if it owns the route.
    const devResp = await handleDev(request, env);
    if (devResp) return devResp;

    if (pathname .startsWith("/dev/email")){
      return await handleDevEmail(request, env);
    }

    // Health
    if (pathname === "/health") {
      return await handleHealth(request, env);
    }

    // Admin
    if (pathname.startsWith("/admin/sends")) {
      return await handleAdminSends(request, env);
    }

    if (pathname.startsWith("/admin/contacts")) {
      return await handleContacts(request, env);
    }

    if (pathname.startsWith("/admin/policy")) {
      return await handlePolicy(request, env);
    }

    if (pathname.startsWith("/admin/config")) {
      return await handleConfig(request, env);
    }

    if (pathname.startsWith("/admin/calendar")) {
      return await handleCalendar(request, env);
    }

    if (pathname.startsWith("/admin/candidates")) {
      return await handleCandidates(request, env);
    }

    if (pathname.startsWith("/admin/weekly")) {
      return await handleWeekly(request, env);
    }

    // Jobs (support both /jobs and /jobs/)
    if (pathname === "/jobs" || pathname.startsWith("/jobs/")) {
      return await handleJobs(request, env);
    }

    // Default
    return json({ status: "error", message: "Not found" }, 404);
  } catch (err) {
    // If a handler throws a Response, pass it through unchanged.
    if (err instanceof Response) return err;

    const status =
      (typeof err?.status === "number" && err.status >= 100 && err.status <= 599)
        ? err.status
        : 500;

    const message =
      status === 500
        ? "Internal Server Error"
        : (err?.message || "Request error");

    // Log useful info without turning it into a second incident.
    console.error(err?.stack || err);

    return json({ status: "error", message }, status);
  }
}