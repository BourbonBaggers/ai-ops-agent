// src/routes/dev_email.js
import { requireJsonBody, json, badRequest } from "../lib/utils.js";
import { graphSendMail } from "../lib/ms_graph.js";

export async function handleDevEmail(request, env) {
  const key = request.headers.get("x-dev-email-key");
  if (!key || key !== env.DEV_EMAIL_KEY) {
    return json({ status: "error", message: "Unauthorized" }, 401);
  }

  const body = await requireJsonBody(request);
  const to = body?.to;
  const subject = body?.subject || "ai-ops-agent test";
  const text = body?.text || "hello from the clanker";

  if (!to) throw badRequest("Missing 'to'");

  const result = await graphSendMail(env, {
    fromUpn: env.GRAPH_SENDER_EMAIL || env.MS_SENDER_UPN,
    to,
    subject,
    html: body?.html || null,
    text,
  });

  return json({ status: "ok", result });
}
