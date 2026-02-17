export async function handleHealth(request, env) {
  try {
    const result = await env.DB.prepare("SELECT 1 as ok").first();
    return json({ status: "ok", db: result.ok === 1 });
  } catch (err) {
    return json({ status: "error", message: err.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" }
  });
}