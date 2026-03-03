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
        preview_text: "One quick idea to help your accounts this week.",
        body_html: `<p>Tie the note to <strong>${nextEvent}</strong>.</p><ul><li>Keep it short</li><li>One clear CTA</li><li>No pricing</li></ul>`,
        body_markdown: `Tie the note to **${nextEvent}**.\n\n- Keep it short\n- One clear CTA\n- No pricing\n`,
        action_line: "Put it into action with your next 3 accounts.",
        quote_text: "Simple to explain and easy to stock.",
        rally_line: "Low effort. High perceived value.",
        cta: "Reply to request the one-pager",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        funnel_stage: "mid",
        subject: "A simple talking point for your next account visit",
        preview_text: "Use this 15-second script to introduce the product without sounding salesy.",
        body_html: "<p>A quick add-on that creates value for the customer without extra work.</p><p>If you want, I can send a leave-behind PDF you can drop at accounts.</p>",
        body_markdown: "A quick add-on that creates value for the customer without extra work.\n\nIf you want, I can send a leave-behind PDF you can drop at accounts.\n",
        action_line: "Put it into action on your next account call.",
        quote_text: "Customers ask for this once they see it in action.",
        rally_line: "Small footprint. Easy to demo. Repeat purchase.",
        cta: "Reply for the leave-behind PDF",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      },
      {
        funnel_stage: "bottom",
        subject: "Retailer-friendly: low effort, high perceived value",
        preview_text: "A positioning angle that's easy to explain and easy to stock.",
        body_html: "<p>Simple to demo. Easy to explain. High-margin add-on.</p><ul><li>Small display footprint</li><li>Proven shelf turns</li><li>Repeat-purchase item</li></ul>",
        body_markdown: "Simple to demo. Easy to explain. High-margin add-on.\n\n- Small display footprint\n- Proven shelf turns\n- Repeat-purchase item\n",
        action_line: "Put it into action — pick 2 accounts and lead with this.",
        quote_text: "Ask if they want a small countertop display for a test run.",
        rally_line: "This is the product that earns its shelf space and stays there.",
        cta: "Reply for a small display option",
        image_url: null,
        image_refs: [],
        self_check: { mentions_pricing: false, contains_emojis: false, contains_emdash: false }
      }
    ];

    return base.slice(0, 3);
  }
}
