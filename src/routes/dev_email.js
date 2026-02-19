// src/routes/dev_email.js
import { requireJsonBody, json, badRequest } from "../lib/utils.js";
import { graphSendMail } from "../lib/ms_graph.js";

export async function handleDevEmail(request, env) {
  const body = await requireJsonBody(request);
  const to = body?.to;
  const subject = body?.subject || "ai-ops-agent test";
  const text = body?.text || "hello from the clanker";

  if (!to) throw badRequest("Missing 'to'");

  const result = await graphSendMail(env, {
    fromUpn: env.MS_SENDER_UPN,
    to,
    subject,
    text,
  });

  return json({ status: "ok", result });
}

