import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/providers/openaiProvider.js";

test("openai provider parses 3 candidates and nulls disallowed image_url", async () => {
  const allowlistedUrl = "https://assets.example.com/Product Pictures/Sized for Websites/A/one.jpg";
  const invalidUrl = "https://evil.example.com/not-allowed.jpg";

  const modelOutput = {
    candidates: [
      {
        funnel_stage: "top",
        subject: "Awareness candidate",
        preview: "Preview one",
        body: "Body one",
        cta: "Bring this up with three accounts this week.",
        image_url: allowlistedUrl,
        variation_hint: null,
      },
      {
        funnel_stage: "mid",
        subject: "Education candidate",
        preview: "Preview two",
        body: "Body two",
        cta: "Add this talking point to your next calls.",
        image_url: invalidUrl,
        variation_hint: "gifting",
      },
      {
        funnel_stage: "bottom",
        subject: "Activation candidate",
        preview: "Preview three",
        body: "Body three",
        cta: "Pitch this to five accounts before Friday.",
        image_url: null,
        variation_hint: null,
      },
    ],
  };

  const stubFetch = async (url, init) => {
    if (String(url).endsWith("/admin/assets")) {
      return Response.json({
        status: "ok",
        flat: [{ productName: "A", key: "A/one.jpg", url: allowlistedUrl }],
        grouped: {},
      });
    }

    if (String(url).includes("/v1/chat/completions")) {
      assert.equal(init.method, "POST");
      return Response.json({
        choices: [{ message: { content: JSON.stringify(modelOutput) } }],
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const provider = new OpenAIProvider({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:8787",
    fetchImpl: stubFetch,
    policyText: "policy text",
  });

  const candidates = await provider.generateCandidates({ variation_hint: "gifting" });
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].image_url, allowlistedUrl);
  assert.equal(candidates[1].image_url, null);
  assert.equal(candidates[2].image_url, null);
});
