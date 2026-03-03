import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/providers/openaiProvider.js";

test("openai provider loads image catalog from D1 and nulls disallowed image_url", async () => {
  const allowlistedUrl = "https://assets.example.com/Product Pictures/Sized for Websites/A/one.jpg";
  const invalidUrl = "https://evil.example.com/not-allowed.jpg";

  const modelOutput = {
    candidates: [
      {
        funnel_stage: "top",
        subject: "Awareness candidate",
        preview: "Preview one",
        body: "Body one",
        body_html: "<p>Body one</p>",
        body_text: "Body one",
        action_line: "Put it into action with 3 accounts.",
        quote_text: "Simple to explain and easy to stock.",
        rally_line: "Low effort. High perceived value.",
        cta: "Bring this up with three accounts this week.",
        image_url: allowlistedUrl,
        variation_hint: null,
      },
      {
        funnel_stage: "mid",
        subject: "Education candidate",
        preview: "Preview two",
        body: "Body two",
        body_html: "<p>Body two</p>",
        body_text: "Body two",
        action_line: "Put it into action on your next account call.",
        quote_text: "Customers ask for this once they see it in action.",
        rally_line: "Small footprint. Easy to demo.",
        cta: "Add this talking point to your next calls.",
        image_url: invalidUrl,
        variation_hint: "seasonal",
      },
      {
        funnel_stage: "bottom",
        subject: "Activation candidate",
        preview: "Preview three",
        body: "Body three",
        body_html: "<p>Body three</p>",
        body_text: "Body three",
        action_line: "Put it into action — pick 2 accounts this week.",
        quote_text: "Strong shelf turns and repeat purchase.",
        rally_line: "One shelf spot, year-round turns.",
        cta: "Share this with five accounts this week.",
        image_url: null,
        variation_hint: null,
      },
    ],
  };

  const db = {
    prepare(sql) {
      assert.match(sql, /FROM email_images/i);
      return {
        bind(limit) {
          assert.equal(limit, 150);
          return {
            async all() {
              return {
                results: [
                  {
                    url: allowlistedUrl,
                    alt: "Product image",
                    description: "Use for product display references",
                    product_name: "A",
                  },
                ],
              };
            },
          };
        },
      };
    },
  };

  let sawOpenAiCall = false;
  const stubFetch = async (url, init) => {
    if (String(url).includes("/v1/chat/completions")) {
      sawOpenAiCall = true;
      assert.equal(init.method, "POST");
      const body = JSON.parse(init.body);
      const prompt = body?.messages?.[1]?.content || "";
      assert.match(prompt, /Use for product display references/);
      return Response.json({
        choices: [{ message: { content: JSON.stringify(modelOutput) } }],
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const provider = new OpenAIProvider({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:8787",
    db,
    fetchImpl: stubFetch,
    policyText: "policy text",
  });

  const candidates = await provider.generateCandidates({ variation_hint: "seasonal" });
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].image_url, allowlistedUrl);
  assert.equal(candidates[1].image_url, null);  // disallowed URL nulled out
  assert.equal(candidates[2].image_url, null);

  // New template-section fields should be normalized through
  assert.equal(candidates[0].funnel_stage, "top");
  assert.equal(candidates[1].funnel_stage, "mid");
  assert.equal(candidates[2].funnel_stage, "bottom");
  assert.equal(candidates[0].action_line, "Put it into action with 3 accounts.");
  assert.equal(candidates[0].quote_text, "Simple to explain and easy to stock.");
  assert.equal(candidates[0].rally_line, "Low effort. High perceived value.");
  assert.equal(sawOpenAiCall, true);
});
