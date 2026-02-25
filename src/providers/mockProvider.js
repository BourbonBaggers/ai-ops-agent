export class MockProvider {
  async generateCandidates(input) {
    // input contains: policy, calendarItems, focusNotes, historySnippets, constraints
    const { calendarItems = [] } = input;

    const nextEvent = calendarItems[0]
      ? `${calendarItems[0].date} – ${calendarItems[0].title}`
      : "upcoming seasonal moment";

    const base = [
      {
        funnel_stage: "top",
        subject: `Weekly touchpoint: ${nextEvent}`,
        preview_text: "One quick idea to help retailers move product this week.",
        body_html: `<p>Tie the note to <strong>${nextEvent}</strong>.</p><ul><li>Keep it short</li><li>One clear CTA</li><li>No pricing</li></ul>`,
        body_markdown: `Tie the note to **${nextEvent}**.\n\n- Keep it short\n- One clear CTA\n- No pricing\n`,
        action_line: "Put it into action with your next 3 accounts.",
        quote_text: "This one's easy to explain and easier to stock.",
        rally_line: "No liquor license required — just a shelf spot and five minutes.",
        cta: "Reply to request the one-pager",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        funnel_stage: "mid",
        subject: "A simple talking point for your next retail visit",
        preview_text: "Use this 15-second script to introduce the product without sounding salesy.",
        body_html: "<p>\"Here's a small add-on that turns a standard pour into a giftable moment without extra work.\"</p><p>If you want, I can send a shelf-talker PDF you can drop at accounts.</p>",
        body_markdown: "\"Here's a small add-on that turns a standard pour into a giftable moment without extra work.\"\n\nIf you want, I can send a shelf-talker PDF you can drop at accounts.\n",
        action_line: "Put it into action on your next gift-shop call.",
        quote_text: "Bourbon drinkers are the hardest to buy for — this solves that.",
        rally_line: "Small footprint. Shelf stable. Proven giftability.",
        cta: "Reply for the shelf-talker PDF",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        funnel_stage: "bottom",
        subject: "Retailer-friendly: low effort, high perceived value",
        preview_text: "A positioning angle that's easy to explain and easy to stock.",
        body_html: "<p>Simple to demo. Easy to explain. Extremely giftable.</p><ul><li>No liquor license required</li><li>Small countertop footprint</li><li>Repeat-purchase gift</li></ul>",
        body_markdown: "Simple to demo. Easy to explain. Extremely giftable.\n\n- No liquor license required\n- Small countertop footprint\n- Repeat-purchase gift\n",
        action_line: "Put it into action — pick 2 men's table accounts and lead with this.",
        quote_text: "Ask if they want a small countertop display for a test run.",
        rally_line: "This is the gift that sells itself twice: once to the buyer, once to the recipient.",
        cta: "Reply for a small display option",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      }
    ];

    return base.slice(0, 3);
  }
}
