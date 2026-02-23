import { OpenAIProvider } from "../src/providers/openaiProvider.js";

const args = parseArgs(process.argv.slice(2));

const provider = new OpenAIProvider({
  baseUrl: args.base_url || process.env.BASE_URL,
});

try {
  const candidates = await provider.generateCandidates({
    variation_hint: args.variation_hint ?? null,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        count: candidates.length,
        candidates,
      },
      null,
      2
    )
  );
} catch (err) {
  console.error(err?.stack || String(err));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--variation_hint" || token === "--variation-hint") {
      parsed.variation_hint = argv[i + 1] ?? "";
      i++;
      continue;
    }
    if (token === "--base_url" || token === "--base-url") {
      parsed.base_url = argv[i + 1] ?? "";
      i++;
      continue;
    }
  }
  return parsed;
}
