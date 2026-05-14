/**
 * URL quote handler — delegates to gchat /api/chat-waterfall with forceLlama
 * so the deterministic quote engine fires first. Returns a clean URL.
 */

export async function handleUrlQuote(env, ctx) {
  const { envelope, classification, match } = ctx;

  const intentText = (envelope.bodyText || "").slice(0, 2000);
  const res = await env.GCHAT.fetch("https://internal/api/chat-waterfall", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.GCHAT_INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      text: intentText,
      source: "email-responder",
      forceLlama: true,
      meta: {
        sender_email: envelope.fromEmail,
        match_level: match.level,
        account_id: match.account?.id || null,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`gchat quote failed: ${err.slice(0, 200)}`);
  }
  const data = await res.json();

  // Expect data.reply to contain the URL quote text from the deterministic engine.
  // Extract the URL for clean inline display.
  const urlMatch = (data.reply || "").match(/https?:\/\/[^\s<>]+/);
  const url = urlMatch ? urlMatch[0] : null;

  return {
    kind: "url_quote",
    bodySegments: [
      `Thanks for reaching out!`,
      url
        ? `For your convenience, here's the quote: ${url}`
        : `I tried to put together a quote but I couldn't auto-generate one — looping in Jay Florendo who can get this turned around quickly.`,
      url ? `That link will let you order online or you can reply with a PO and we'll process it. Let me know what you think!` : null,
    ].filter(Boolean),
    needsHumanFollowup: !url,
    extraCcJay: !url,
  };
}
