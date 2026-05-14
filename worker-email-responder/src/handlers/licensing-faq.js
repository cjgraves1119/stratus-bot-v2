/**
 * Licensing FAQ — answers come from the curated KB only. No free-form generation.
 * Uses Llama for semantic match against the KB titles, then returns the exact KB answer.
 */

import kb from "../kb/licensing-faq.json";

export async function handleLicensingFaq(env, ctx) {
  const { envelope } = ctx;
  const text = `Subject: ${envelope.subject}\n\n${(envelope.bodyText || "").slice(0, 1500)}`;

  const match = await selectKbEntry(env, text, kb);
  if (!match) {
    return {
      kind: "licensing_faq_miss",
      bodySegments: [
        `Thanks for the question!`,
        `I didn't have a confident answer ready for this one, so I've looped in Jay Florendo on this thread to get you a proper response.`,
      ],
      extraCcJay: true,
    };
  }

  return {
    kind: "licensing_faq",
    bodySegments: [
      `Thanks for reaching out!`,
      match.answer,
      match.followup || `Let me know if this helped or if you'd like more detail.`,
    ],
  };
}

async function selectKbEntry(env, query, entries) {
  const titles = entries.map((e, i) => `${i}: ${e.question}`).join("\n");
  const prompt = `You are matching a customer email to a knowledge base entry. Return ONLY the index number of the best match, or -1 if no entry is a confident match (>0.8).

KB entries:
${titles}

Customer email:
${query}

Output: just the number.`;

  try {
    const resp = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8,
      temperature: 0,
    });
    const raw = (resp?.response || "").trim();
    const idx = parseInt(raw, 10);
    if (isNaN(idx) || idx < 0 || idx >= entries.length) return null;
    return entries[idx];
  } catch {
    return null;
  }
}
