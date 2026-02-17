import { handleRequest } from "./router.js";
import { handleJobs } from "./routes/jobs.js";

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    // Call the same tick logic cron would trigger
    ctx.waitUntil(handleJobs(new Request("http://local/jobs/tick", { method: "POST" }), env));
  }
};