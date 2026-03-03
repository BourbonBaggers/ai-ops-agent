# Weekly Outreach Policy (Example Template)

Use this file as a starting point. Replace placeholders with your brand specifics.
This policy is designed to be passed into an LLM that generates weekly email candidates.

---

## 1. Purpose

Write weekly B2B emails that enable and motivate recipients to sell/promote our product.

Primary objective:
- Drive the recipient to take a defined action (the “conversion event”) that supports revenue.

Conversion event definition:
- [Define what “conversion” means for your workflow, e.g., “rep pitches to 3 accounts” or “buyer places a reorder”]

Non-goals:
- No “brand storytelling for its own sake”
- No vanity engagement chasing
- No random content with no action

---

## 2. Audience

Who receives these emails:
- [e.g., independent sales reps, retail buyers, distributors, partners]

Recipient context:
- Typical job: [what they do day-to-day]
- What they care about: [commission, sell-through, ease of pitch, novelty, seasonal timing, margin]
- What they hate: [long explanations, fluff, complicated setup, risky claims]

Assumptions:
- [e.g., “All contacts are sales reps.”]
- [e.g., “First name is available and is the rep name.”]

---

## 3. Funnel Stages and Distribution

Each email must target exactly one funnel stage:

### Top of Funnel (Awareness)
Goal:
- [brand awareness + “remember we exist”]
Includes:
- [what the product is, where it fits, why it’s relevant]

### Mid Funnel (Excitement + Education)
Goal:
- [help them pitch it credibly]
Includes:
- [talking points, objections, placements, what’s working]

### Bottom Funnel (Activation)
Goal:
- [get them to actively sell this week]
Includes:
- [a concrete action plan, earned urgency, specific ask]

Distribution (for candidate generation):
- Default weekly mix (example): [2 top + 1 mid], bottom only when clearly justified.
- Or segmented mix (example):
  - Segment A: [e.g., order_count = 0 -> top-heavy]
  - Segment B: [e.g., order_count > 0 -> bottom-heavy]

Important:
- Do NOT force one of each funnel stage unless explicitly required.

---

## 4. Product and Value Proposition

### One-liner
- “[One sentence that explains what it is and why it matters]”

### What it is
- Category: [what category it belongs to]
- What it does: [core benefit in plain language]
- How fast it works / effort required: [minutes, days, etc.]

### What it is NOT
- [List common misconceptions or wrong category labels]

### Key differentiators
- [Why it’s different from competitors]
- [Time-to-value advantage, simplicity, novelty, demo ability, gifting fit, etc.]

### Compliance / clarity language
If licensing is mentioned:
- Use: “[No liquor license required]”
- Never use: “[No licenses needed]” (too ambiguous)

Hard boundaries:
- No medical/health claims
- No irresponsible-use language
- No unverifiable claims (“#1”, “best”, “guaranteed”)

---

## 5. Buyer and Use-Case Framing

Primary purchase driver:
- [e.g., gifting, self-purchase, seasonal set, impulse add-on]

Where it wins in retail:
- [placement examples: checkout, men’s table, barware area, gift wall]

Simple pitch lines (rep-ready / buyer-ready):
- “[…]”
- “[…]”
- “[…]”

Objections + simple responses:
- Objection: “[…]”
  - Response: “[…]”
- Objection: “[…]”
  - Response: “[…]”

---

## 6. Brand Voice and Tone

Must be:
- Practical and confident
- Friendly but not casual
- Clear and direct
- Skimmable
- Written for busy professionals

Avoid:
- Hype language
- Corporate jargon
- Policy-echo phrasing (don’t sound like you’re summarizing the prompt)
- Overly clinical “as we gear up…” filler

---

## 7. Content Standards

Every email must include:
- 1 timely context hook (real calendar moment or real retail scenario)
- 1 quoteable line the recipient can reuse verbatim
- 1 reason this is easy for the buyer/account (footprint, setup, shelf-stable, demo-ready, etc.)
- Exactly 1 primary CTA

Seasonal awareness rules:
- Do NOT say “this season” unless you name the season/holiday/event.
- Anchor to real moments:
  - [examples: post-Valentine shelf gaps, spring reset, Father’s Day ramp, National Bourbon Day, holiday ramp]

---

## 8. Subject and Preview Text

Subject:
- 30–55 characters
- Clear benefit + mild curiosity
- No clickbait
- Avoid spammy words (FREE, URGENT, ACT NOW)

Preview (preheader):
- 60–90 characters
- Complements subject, doesn’t repeat it

---

## 9. Email Structure Requirements

1. Opening (1–2 sentences)
2. Value section (2–5 bullets)
3. Action block (see below)
4. One CTA
5. Footer placeholders (if your system uses them)

Target length:
- 120–220 words excluding footer

---

## 10. Action Block Format

The email body should include a distinct action section.

Required elements:
- “Put it into action…” line
- A quote/pullquote (something that sounds like a real human said it)
- A short rally line (no fake urgency)
- CTA text (CTA rendering handled elsewhere if templated)

---

## 11. Images and Asset Usage

Allowed image sources:
- [Your approved asset library source, e.g., D1 allowlist table]

Rules:
- Only use allowlisted image URLs. Never invent URLs.
- Prefer 0 or 1 image per email.
- Image choice must match the email’s angle.

If using image metadata:
- Use image description to pick the best match to the email’s topic.
- Alt text must be short and literal (what’s in the image).

---

## 12. Personalization Variables (If Available)

Available variables:
- {{firstname}}
- {{rep_name}}
- {{region}}
- {{ASSET_LIBRARY_URL}}
- {{UNSUBSCRIBE_LINK}}
- [Add yours]

Name usage guidance:
- Optional, not required
- Use at most once
- Never force it if it makes the email feel automated

---

## 13. Output Contract (For the LLM)

The model must return JSON only.

Top-level schema:
{
  "candidates": [
    {
      "funnel_stage": "top|mid|bottom",
      "subject": "...",
      "preview": "...",

      "body_html": "...", 
      "body_text": "...",

      "quote": "...",
      "cta": "...",

      "image_url": "..." | null,
      "variation_hint": "..." | null,

      "self_check": {
        "mentions_pricing": false,
        "emojis": false,
        "em_dashes": false,
        "one_primary_cta": true
      }
    }
  ]
}

Rules:
- Exactly 3 candidates per generation.
- Candidates must be meaningfully different (not paraphrases).
- body_html must be a fragment intended for template insertion.
- body_text must match body_html meaning (multipart email).
- No markdown fences. No explanations outside JSON.

HTML fragment allowed tags ONLY:
- <p>
- <ul>
- <li>
- <strong>
- <em>
- <a>
- <br>

Do NOT use:
- <div>, <span>
- tables
- images
- <style>
- full HTML documents

---

## 14. Variation Hint (Optional)

If variation_hint is provided:
- Use it as creative direction, but do not literally repeat it.

If variation_hint is null/empty:
- Ignore it and generate normally.

---

## 15. Compliance Self-Check

Before output, ensure:
- Exactly one funnel objective per candidate
- Gift framing (if your product is gifting-led) is reflected appropriately
- No pricing/discounts/terms unless explicitly allowed
- No vague “season” phrasing without calendar anchor
- No “no licenses needed” ambiguity if licensing is mentioned