/**
 * Decides what the bot is allowed to do given:
 *   - classifier intent + confidence
 *   - sender match level
 *   - extracted features (money_mentioned, reference_tokens, urgency)
 *
 * Returns a Decision:
 *   {
 *     action: "auto_send" | "draft_for_review" | "escalate_to_jay",
 *     handler: "url_quote" | "licensing_faq" | "order_status" | "escalation" | "draft_only",
 *     reason: string
 *   }
 *
 * Codex council narrowed the auto-send allowlist. This module enforces it.
 */

import { MATCH_LEVELS } from "./sender-match.js";

const AUTO_SEND_INTENTS = new Set([
  "url_quote",
  "licensing_faq",
  "order_status",
  "routing_acknowledgment", // synthetic — never classified, only emitted by gate
]);

export function decideAction(env, { classification, match }) {
  const floor = Number(env.CLASSIFIER_CONFIDENCE_FLOOR || "0.75");
  const sendMode = env.SEND_MODE || "dry_run";

  // Hard kill paths always lift to escalate
  if (classification.intent === "modify_order") {
    return escalate("modify_order intent");
  }
  if (classification.intent === "financial_legal") {
    return escalate("financial_legal intent");
  }
  if (classification.intent === "support_question") {
    return escalate("support_question — not our scope");
  }
  if (classification.extracted.money_mentioned && classification.intent !== "url_quote") {
    return escalate("money mentioned outside quote intent");
  }
  if (classification.intent === "out_of_scope") {
    // Don't reply at all — but log
    return { action: "no_reply", handler: null, reason: "out_of_scope" };
  }

  // Confidence floor
  if (classification.confidence < floor) {
    return draftForReview(`confidence ${classification.confidence.toFixed(2)} < floor ${floor}`);
  }

  // Hardware recommend is never auto-send
  if (classification.intent === "hardware_recommend") {
    return draftForReview("hardware_recommend never auto-sends");
  }

  // General inquiry: ack + escalate
  if (classification.intent === "general_inquiry") {
    return escalate("general_inquiry — looping in Jay");
  }

  // Sender-match policy enforcement
  if (classification.intent === "url_quote") {
    // Domain-only OK for generic URL. Exact contact required if quote needs account pricing.
    if (match.level === MATCH_LEVELS.MULTI_DOMAIN) return escalate("multi-account domain");
    if (match.level === MATCH_LEVELS.FREE_EMAIL && match.level !== MATCH_LEVELS.EXACT_CONTACT) {
      return escalate("free email domain with no contact match");
    }
    if (match.level === MATCH_LEVELS.NO_MATCH) {
      // New corporate sender: still allow generic URL quote
      return auto("url_quote", "generic url quote, unknown sender");
    }
    return auto("url_quote", `${match.level} match`);
  }

  if (classification.intent === "licensing_faq") {
    // Allowed at all match levels — answer comes from fixed KB
    return auto("licensing_faq", "kb-backed faq");
  }

  if (classification.intent === "order_status") {
    if (match.level !== MATCH_LEVELS.EXACT_CONTACT) {
      return escalate("order_status requires exact contact match");
    }
    if (!classification.extracted.reference_tokens?.length) {
      return draftForReview("order_status with no reference token");
    }
    return auto("order_status", "exact contact + reference token");
  }

  // Default: escalate
  return escalate("default — unhandled intent");
}

function auto(handler, reason) {
  return { action: "auto_send", handler, reason };
}
function draftForReview(reason) {
  return { action: "draft_for_review", handler: "draft_only", reason };
}
function escalate(reason) {
  return { action: "escalate_to_jay", handler: "escalation", reason };
}
