export class MockProvider {
  async generateCandidates(input) {
    // input contains: policy, calendarItems, focusNotes, historySnippets, constraints
    const { calendarItems = [] } = input;

    const nextEvent = calendarItems[0]
      ? `${calendarItems[0].date} – ${calendarItems[0].title}`
      : "upcoming seasonal moment";

    const base = [
      {
        subject: `Weekly touchpoint: ${nextEvent}`,
        preview_text: "One quick idea to help retailers move product this week.",
        body_markdown: `## This week’s angle\n\nTie the note to **${nextEvent}**.\n\n- Keep it short\n- One clear CTA\n- No pricing\n\n## Quick CTA\nReply with “interested” and I’ll send a one-pager you can forward.\n`,
        cta: "Reply to request the one-pager",
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        subject: "A simple talking point for your next retail visit",
        preview_text: "Use this 15-second script to introduce the product without sounding salesy.",
        body_markdown: `## A 15-second opener\n\n“Here’s a small add-on that turns a standard pour into a giftable moment without extra work.”\n\n## One request\nIf you want, I can send a shelf-talker PDF you can drop at accounts.\n`,
        cta: "Reply for the shelf-talker PDF",
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        subject: "Retailer-friendly: low effort, high perceived value",
        preview_text: "A positioning angle that’s easy to explain and easy to stock.",
        body_markdown: `## Positioning angle\n\n- Simple to demo\n- Easy to explain\n- Giftable\n\n## What to do next\nAsk accounts if they want a small countertop display for a test run.\n`,
        cta: "Reply for a small display option",
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      }
    ];

    return base.slice(0, 3);
  }
}