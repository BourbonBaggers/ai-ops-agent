import { loadSettings } from "../lib/settings.js";
import { json } from "../lib/utils.js";

export async function handleConfig(request, env) {
  const settings = loadSettings(env);
  return json({ status: "ok", config: settings });
}