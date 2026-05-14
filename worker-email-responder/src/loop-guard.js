/**
 * Loop guard — never auto-reply to anything that smells like an auto-reply,
 * NDR, mailing list, calendar invite, or our own outbound.
 *
 * Codex flagged this as one of the highest-burn risks. Be aggressive on
 * skip-side. False negative = miss replying. False positive = embarrassing
 * autoreply storm. Prefer the former.
 */

const STRATUS_AUTOMATION_SENDERS = new Set([
  "ai@stratusinfosystems.com",
  "noreply@stratusinfosystems.com",
  "no-reply@stratusinfosystems.com",
]);

const NDR_SENDERS = [
  /mailer-daemon@/i,
  /postmaster@/i,
  /^\s*$/, // empty envelope (Return-Path: <>)
];

export function shouldSkip(env, envelope) {
  const reasons = [];

  // Auto-Submitted header
  const autoSubmitted = (envelope.autoSubmitted || "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") {
    reasons.push(`auto-submitted=${autoSubmitted}`);
  }

  // Precedence
  const prec = (envelope.precedence || "").toLowerCase();
  if (/^(bulk|list|junk|auto_reply)/.test(prec)) {
    reasons.push(`precedence=${prec}`);
  }

  // Mailing list markers
  if (envelope.listId) reasons.push(`list-id present`);
  if (envelope.listUnsubscribe) reasons.push(`list-unsubscribe present`);

  // Outlook-style suppress
  if (envelope.xAutoResponseSuppress) reasons.push(`x-auto-response-suppress`);

  // NDRs
  for (const re of NDR_SENDERS) {
    if (re.test(envelope.fromEmail || "")) {
      reasons.push("ndr sender");
      break;
    }
  }
  const returnPath = (envelope.returnPath || "").trim();
  if (returnPath === "<>" || returnPath === "") {
    // Empty Return-Path is the classic NDR / auto-bounce signal
    if (envelope.fromEmail && /mailer-daemon|postmaster|noreply|no-reply/i.test(envelope.fromEmail)) {
      reasons.push("empty return-path + system sender");
    }
  }

  // Self-loop: our own outbound coming back in
  if (envelope.fromEmail && STRATUS_AUTOMATION_SENDERS.has(envelope.fromEmail)) {
    reasons.push("sender is our own automation");
  }

  // Internal Stratus senders never get auto-replied to (handled by colleagues, not bots)
  const stratusDomains = (env.STRATUS_DOMAINS || "").split(",").map(s => s.trim().toLowerCase());
  if (envelope.senderDomain && stratusDomains.includes(envelope.senderDomain)) {
    reasons.push("internal stratus sender");
  }

  // Calendar invites / iCal
  if (/text\/calendar|method=request|method=publish/i.test(envelope.contentType || "")) {
    reasons.push("calendar invite");
  }

  // Attachments-only with no body
  if (envelope.hasAttachments && (!envelope.bodyText || envelope.bodyText.trim().length < 20)) {
    reasons.push("attachments-only");
  }

  // Existing AI signature marker in thread (we already replied)
  const marker = env.BOT_SIGNATURE_TOKEN || "x-stratus-ai-msg-v1";
  if ((envelope.bodyText || "").includes(marker)) {
    reasons.push("ai signature marker in body");
  }

  // Jay already in the thread (don't pile on)
  const jay = (env.JAY_FLORENDO_EMAIL || "").toLowerCase();
  const allRecips = [...(envelope.to || []), ...(envelope.cc || [])];
  if (jay && allRecips.includes(jay)) {
    reasons.push("jay already on thread");
  }

  // Receipts / common transactional patterns
  if (/no-?reply@|donot-?reply@|notifications?@|alerts?@|billing@/i.test(envelope.fromEmail || "")) {
    reasons.push("transactional sender pattern");
  }

  // Subject patterns
  const subj = (envelope.subject || "").toLowerCase();
  if (/^(auto:|automatic reply|out of office|undeliverable|delivery (status|failure)|mail delivery)/i.test(subj)) {
    reasons.push(`subject pattern: ${subj.slice(0, 40)}`);
  }

  return { skip: reasons.length > 0, reasons };
}
