/**
 * Per-envelope processing pipeline. Wires the modules together.
 *
 *   dedupe → loop guard → sender match → classify → risk gate
 *           → handler → reply builder → send/draft → audit
 *
 * Every envelope produces an audit row regardless of outcome.
 */

import { checkAndMarkSeen } from "./dedupe.js";
import { shouldSkip } from "./loop-guard.js";
import { matchSender } from "./sender-match.js";
import { classifyEmail } from "./classifier.js";
import { decideAction } from "./risk-gate.js";
import { buildReply } from "./reply-builder.js";
import { sendOrDraft } from "./sender.js";
import { writeAudit } from "./audit.js";
import { checkRateLimit } from "./rate-limit.js";

import { handleUrlQuote } from "./handlers/url-quote.js";
import { handleLicensingFaq } from "./handlers/licensing-faq.js";
import { handleOrderStatus } from "./handlers/order-status.js";
import { handleEscalation } from "./handlers/escalation.js";
import { handleDraftOnly } from "./handlers/draft-only.js";

export async function processEnvelope(env, envelope, path) {
  const audit = {
    path,
    gmailMessageId: envelope.gmailMessageId,
    threadId: envelope.gmailThreadId,
    fromEmail: envelope.fromEmail,
    subject: envelope.subject,
    receivedAt: new Date(envelope.internalDateMs).toISOString(),
  };

  // 1. Dedupe
  const dup = await checkAndMarkSeen(env, envelope);
  if (dup.duplicate) {
    await writeAudit(env, { ...audit, outcome: "duplicate", reason: dup.hitKey });
    return { outcome: "duplicate" };
  }

  // 2. Loop guard
  const skip = shouldSkip(env, envelope);
  if (skip.skip) {
    await writeAudit(env, { ...audit, outcome: "skipped", reason: skip.reasons.join("; ") });
    return { outcome: "skipped", reasons: skip.reasons };
  }

  // 3. Rate limits
  const rate = await checkRateLimit(env, envelope);
  if (!rate.allowed) {
    await writeAudit(env, { ...audit, outcome: "rate_limited", reason: rate.reason });
    return { outcome: "rate_limited", reason: rate.reason };
  }

  // 4. Sender match
  const match = await matchSender(env, envelope.fromEmail);

  // 5. Classify
  const classification = await classifyEmail(env, envelope);

  // 6. Decide
  const decision = decideAction(env, { classification, match });

  audit.match_level = match.level;
  audit.intent = classification.intent;
  audit.confidence = classification.confidence;
  audit.decision_action = decision.action;
  audit.decision_handler = decision.handler;
  audit.decision_reason = decision.reason;

  if (decision.action === "no_reply") {
    await writeAudit(env, { ...audit, outcome: "no_reply" });
    return { outcome: "no_reply", intent: classification.intent };
  }

  // 7. Run handler
  const ctx = { envelope, match, classification, decision, path };
  let handlerOutput;
  try {
    handlerOutput = await runHandler(env, ctx);
  } catch (err) {
    await writeAudit(env, { ...audit, outcome: "handler_error", reason: err.message });
    return { outcome: "handler_error", error: err.message };
  }

  // 8. Build reply
  const reply = buildReply(env, ctx, handlerOutput);

  // 9. Send or draft (respects SEND_MODE)
  const sendResult = await sendOrDraft(env, ctx, reply);

  audit.outcome = sendResult.outcome;
  audit.reply_subject = reply.subject;
  audit.reply_preview = reply.bodyText.slice(0, 200);
  audit.cc_jay = Boolean(reply.cc?.includes(env.JAY_FLORENDO_EMAIL));
  audit.send_mode = env.SEND_MODE;

  await writeAudit(env, audit);

  return {
    outcome: sendResult.outcome,
    intent: classification.intent,
    decision: decision.action,
    reply_subject: reply.subject,
  };
}

async function runHandler(env, ctx) {
  switch (ctx.decision.handler) {
    case "url_quote": return handleUrlQuote(env, ctx);
    case "licensing_faq": return handleLicensingFaq(env, ctx);
    case "order_status": return handleOrderStatus(env, ctx);
    case "escalation": return handleEscalation(env, ctx);
    case "draft_only": return handleDraftOnly(env, ctx);
    default: throw new Error(`unknown handler: ${ctx.decision.handler}`);
  }
}
