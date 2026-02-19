// src/lib/ms_graph.js

let tokenCache = {
  accessToken: null,
  expiresAtMs: 0,
};

function nowMs() {
  return Date.now();
}

export async function getGraphToken(env) {
  // refresh 60s early
  if (tokenCache.accessToken && nowMs() < tokenCache.expiresAtMs - 60_000) {
    return tokenCache.accessToken;
  }

  const url = `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("client_id", env.MS_CLIENT_ID);
  body.set("client_secret", env.MS_CLIENT_SECRET);
  body.set("grant_type", "client_credentials");
  body.set("scope", "https://graph.microsoft.com/.default"); // client creds pattern  [oai_citation:4‡Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow)

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token error ${res.status}: ${text}`);
  }

  const data = await res.json();
  tokenCache.accessToken = data.access_token;
  tokenCache.expiresAtMs = nowMs() + (data.expires_in * 1000);
  return tokenCache.accessToken;
}

export async function graphSendMail(env, { fromUpn, to, subject, text }) {
  const token = await getGraphToken(env);

  // POST /users/{id|UPN}/sendMail  [oai_citation:5‡Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(fromUpn)}/sendMail`;

  const replyTo = (env.REPLY_TO || "").trim();

  const message = {
    subject,
    body: { contentType: "Text", content: text },
    toRecipients: [{ emailAddress: { address: to } }],
    ...(replyTo
      ? { replyTo: [{ emailAddress: { address: replyTo } }] }
      : {}),
  };

  const payload = {
    message,
    saveToSentItems: "true",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  // sendMail returns 202 Accepted on success in many cases; docs show "success" without a body  [oai_citation:6‡Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph sendMail error ${res.status}: ${text}`);
  }

  return { ok: true, status: res.status };
}