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
        quote_text: "This sells itself.",
        rally_line: "No liquor license required.",
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
        action_line: "Put it into action on your next gift-shop call.",
        quote_text: "Bourbon drinkers are the hardest to buy for.",
        rally_line: "Small footprint. Shelf stable.",
        cta: "Add this talking point to your next calls.",
        image_url: invalidUrl,
        variation_hint: "gifting",
      },
      {
        funnel_stage: "bottom",
        subject: "Activation candidate",
        preview: "Preview three",
        body: "Body three",
        body_html: "<p>Body three</p>",
        body_text: "Body three",
        action_line: "Put it into action — pick 2 accounts this week.",
        quote_text: "This is the gift that sells itself twice.",
        rally_line: "One shelf spot, year-round turns.",
        cta: "Pitch this to five accounts before Friday.",
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
                    description: "Use for gift display references",
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
      assert.match(prompt, /Use for gift display references/);
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

  const candidates = await provider.generateCandidates({ variation_hint: "gifting" });
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].image_url, allowlistedUrl);
  assert.equal(candidates[1].image_url, null);  // disallowed URL nulled out
  assert.equal(candidates[2].image_url, null);

  // New template-section fields should be normalized through
  assert.equal(candidates[0].funnel_stage, "top");
  assert.equal(candidates[1].funnel_stage, "mid");
  assert.equal(candidates[2].funnel_stage, "bottom");
  assert.equal(candidates[0].action_line, "Put it into action with 3 accounts.");
  assert.equal(candidates[0].quote_text, "This sells itself.");
  assert.equal(candidates[0].rally_line, "No liquor license required.");
  assert.equal(sawOpenAiCall, true);
});
