/**
 * Email-specific intent classifier. NOT the Webex V2 classifier.
 *
 * Codex pushback: V2 was tuned for short SKU-laden chat messages, not messy
 * forwarded threads, signatures, multi-intent prose. Build a fresh one.
 *
 * Primary: Llama 4 Scout via Workers AI.
 * Fallback: Claude Sonnet 4.6 via gchat AI Gateway.
 *
 * Output schema (strict):
 *   {
 *     intent: "url_quote" | "licensing_faq" | "order_status" | "hardware_recommend"
 *           | "modify_order" | "financial_legal" | "support_question" | "general_inquiry"
 *           | "out_of_scope" | "unknown",
 *     confidence: 0..1,
 *     reasoning: short string,
 *     extracted: {
 *       skus: string[],            // any SKUs mentioned
 *       reference_tokens: string[],// SO#, PO#, quote#, tracking#
 *       hardware_mentions: string[],
 *       money_mentioned: bool,     // any dollar amount or pricing-exception language
 *       urgency_signal: bool,      // ASAP, urgent, today, immediately
 *     }
 *   }
 *
 * Confidence floor: < CLASSIFIER_CONFIDENCE_FLOOR (default 0.75) → escalate.
 */

const SYSTEM_PROMPT = `You classify inbound sales emails for an AI assistant covering a sales rep who is out of office.

The assistant has these handlers:
- url_quote: customer wants a price quote for specific Cisco/Meraki SKUs. Auto-send if confidence high.
- licensing_faq: how-to question about Meraki dashboard licensing (e.g. "how do I apply a license", "where do I see my license expiration").
- order_status: customer asking about shipping/order status. Requires a reference token (SO#, PO#, quote#, tracking#).
- hardware_recommend: customer asking what to buy. ALWAYS draft for human review; never auto-send.
- modify_order: customer wants to change/cancel/return an existing order. ALWAYS escalate to human.
- financial_legal: pricing exceptions, contracts, terms, NET-90, payment plans. ALWAYS escalate.
- support_question: technical troubleshooting of deployed gear. ALWAYS escalate (not our job).
- general_inquiry: introduction, vendor discovery, general questions.
- out_of_scope: spam, unrelated, marketing pitches.
- unknown: cannot determine.

Rules:
1. Be conservative. When in doubt, mark "unknown" with low confidence and let the human handle it.
2. Multiple intents in one email = pick the highest-risk one (lowest auto-send eligibility).
3. Mentions of money, pricing exceptions, contract terms, RMA, refunds, or legal language ALWAYS lift to financial_legal regardless of other content.
4. Out-of-office or vacation auto-replies from the sender = out_of_scope.
5. Forwarded threads: classify based on the most recent inbound message, not the original.

Output JSON only. No prose.`;

const EXAMPLES = [
  {
    input: "Hi! Can you send me a quote for 10x MR46 with 3-year licenses?",
    output: {
      intent: "url_quote",
      confidence: 0.95,
      reasoning: "Clear quote request with SKU and term",
      extracted: { skus: ["MR46"], reference_tokens: [], hardware_mentions: ["MR46"], money_mentioned: false, urgency_signal: false },
    },
  },
  {
    input: "Where's my order? PO 12345.",
    output: {
      intent: "order_status",
      confidence: 0.92,
      reasoning: "Status request with PO reference",
      extracted: { skus: [], reference_tokens: ["PO 12345"], hardware_mentions: [], money_mentioned: false, urgency_signal: false },
    },
  },
  {
    input: "Can you do better on the price? We're seeing 25% from another VAR.",
    output: {
      intent: "financial_legal",
      confidence: 0.88,
      reasoning: "Pricing exception request",
      extracted: { skus: [], reference_tokens: [], hardware_mentions: [], money_mentioned: true, urgency_signal: false },
    },
  },
  {
    input: "How do I claim a Meraki license on my dashboard?",
    output: {
      intent: "licensing_faq",
      confidence: 0.9,
      reasoning: "Dashboard licensing how-to",
      extracted: { skus: [], reference_tokens: [], hardware_mentions: [], money_mentioned: false, urgency_signal: false },
    },
  },
  {
    input: "We need to add a wireless solution to our new office. Maybe 15 APs?",
    output: {
      intent: "hardware_recommend",
      confidence: 0.85,
      reasoning: "Open-ended hardware sizing request",
      extracted: { skus: [], reference_tokens: [], hardware_mentions: ["APs"], money_mentioned: false, urgency_signal: false },
    },
  },
];

export async function classifyEmail(env, envelope) {
  const userText = `Subject: ${envelope.subject}\n\nFrom: ${envelope.fromEmail}\n\nBody:\n${(envelope.bodyText || "").slice(0, 4000)}`;

  // Primary: Llama 4 Scout
  try {
    const result = await runLlama(env, userText);
    if (result) return validate(result);
  } catch (err) {
    console.warn(`[classifier] llama failed: ${err.message}`);
  }

  // Fallback: Claude via gchat gateway
  try {
    const result = await runClaude(env, userText);
    if (result) return validate(result);
  } catch (err) {
    console.warn(`[classifier] claude failed: ${err.message}`);
  }

  return {
    intent: "unknown",
    confidence: 0,
    reasoning: "classifier failed",
    extracted: { skus: [], reference_tokens: [], hardware_mentions: [], money_mentioned: false, urgency_signal: false },
  };
}

async function runLlama(env, userText) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...EXAMPLES.flatMap(ex => [
      { role: "user", content: ex.input },
      { role: "assistant", content: JSON.stringify(ex.output) },
    ]),
    { role: "user", content: userText },
  ];
  const resp = await env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
    messages,
    response_format: { type: "json_object" },
    max_tokens: 512,
    temperature: 0,
  });
  const raw = resp?.response || resp?.choices?.[0]?.message?.content;
  if (!raw) return null;
  return parseJson(raw);
}

async function runClaude(env, userText) {
  const res = await env.GCHAT.fetch("https://internal/api/chat-waterfall", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.GCHAT_INTERNAL_TOKEN },
    body: JSON.stringify({
      text: userText,
      forceClaude: true,
      systemOverride: SYSTEM_PROMPT,
      responseFormat: "json",
      meta: { source: "email-responder-classifier" },
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return parseJson(data.reply || "");
}

function parseJson(raw) {
  try {
    if (typeof raw === "object") return raw;
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

function validate(obj) {
  const intents = new Set([
    "url_quote", "licensing_faq", "order_status", "hardware_recommend",
    "modify_order", "financial_legal", "support_question", "general_inquiry",
    "out_of_scope", "unknown",
  ]);
  return {
    intent: intents.has(obj.intent) ? obj.intent : "unknown",
    confidence: typeof obj.confidence === "number" ? Math.max(0, Math.min(1, obj.confidence)) : 0,
    reasoning: String(obj.reasoning || "").slice(0, 280),
    extracted: {
      skus: Array.isArray(obj.extracted?.skus) ? obj.extracted.skus.slice(0, 20) : [],
      reference_tokens: Array.isArray(obj.extracted?.reference_tokens) ? obj.extracted.reference_tokens.slice(0, 10) : [],
      hardware_mentions: Array.isArray(obj.extracted?.hardware_mentions) ? obj.extracted.hardware_mentions.slice(0, 20) : [],
      money_mentioned: Boolean(obj.extracted?.money_mentioned),
      urgency_signal: Boolean(obj.extracted?.urgency_signal),
    },
  };
}
