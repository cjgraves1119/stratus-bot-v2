/**
 * Draft-only — for intents we won't auto-send but might want to seed a reply
 * for human review (hardware_recommend, low-confidence cases).
 *
 * Composes a candidate reply by calling gchat /api/chat-waterfall in advisory
 * mode. The reply-builder will mark it as a Gmail draft regardless of SEND_MODE.
 */

export async function handleDraftOnly(env, ctx) {
  const { envelope } = ctx;
  const userText = `Customer email:\nSubject: ${envelope.subject}\n\n${(envelope.bodyText || "").slice(0, 2000)}\n\nDraft a friendly reply Chris could send. Don't make any commitments on pricing, delivery, or contracts. If this is a sizing/recommendation question, ask 2-3 clarifying questions instead of recommending specifics.`;

  let advice = "";
  try {
    const res = await env.GCHAT.fetch("https://internal/api/chat-waterfall", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.GCHAT_INTERNAL_TOKEN },
      body: JSON.stringify({
        text: userText,
        source: "email-responder-draft",
        forceLlama: true,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      advice = data.reply || "";
    }
  } catch (err) {
    console.warn(`[draft-only] gchat failed: ${err.message}`);
  }

  return {
    kind: "draft_only",
    isDraft: true,
    bodySegments: [
      advice || `Thanks for reaching out — I'll review and get back with details shortly.`,
    ],
  };
}
