/**
 * Send or draft via Gmail API.
 *
 * SEND_MODE controls behavior:
 *   - dry_run     → log only, no Gmail API write
 *   - draft_only  → users.drafts.create (no send)
 *   - auto_send   → users.messages.send for approved low-risk reply objects
 *
 * The reply object carries `isDraft` which forces draft mode regardless of SEND_MODE.
 *
 * Identity:
 *   - ai_alias mailbox → from ai@stratusinfosystems.com
 *   - chris_ooo mailbox → from chrisg@... (uses send-as alias if available)
 */

import { getAccessToken } from "./gmail-oauth.js";

const PATH_TO_REFRESH = {
  ai_alias: "GOOGLE_REFRESH_TOKEN_AI",
  chris_ooo: "GOOGLE_REFRESH_TOKEN_CHRIS",
};

export async function sendOrDraft(env, ctx, reply) {
  const mode = env.SEND_MODE || "dry_run";

  if (mode === "dry_run") {
    return { outcome: "dry_run_logged" };
  }

  const useDraft = reply.isDraft || mode === "draft_only";
  const refreshToken = env[PATH_TO_REFRESH[ctx.path]];
  if (!refreshToken) return { outcome: "missing_refresh_token" };

  const accessToken = await getAccessToken(env, refreshToken);
  const rawMime = buildMime(env, ctx, reply);
  const rawB64 = b64UrlEncode(rawMime);

  const userEmail = reply.fromIdentity.email;

  if (useDraft) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/drafts`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ message: { raw: rawB64, threadId: reply.threadId } }),
      },
    );
    if (!res.ok) return { outcome: "draft_failed", error: (await res.text()).slice(0, 300) };
    return { outcome: "drafted" };
  }

  // auto_send
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(userEmail)}/messages/send`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: rawB64, threadId: reply.threadId }),
    },
  );
  if (!res.ok) return { outcome: "send_failed", error: (await res.text()).slice(0, 300) };
  return { outcome: "sent" };
}

function buildMime(env, ctx, reply) {
  const fromHeader = `${reply.fromIdentity.name} <${reply.fromIdentity.email}>`;
  const to = ctx.envelope.fromEmail;
  const ccLine = reply.cc?.length ? `Cc: ${reply.cc.join(", ")}\r\n` : "";
  // Gmail API users.messages.send respects Bcc in MIME: delivers to BCC
  // recipients while stripping the header from copies sent to To/Cc. Safe.
  // For drafts.create, the Bcc stays on the draft and only fires on send.
  const bccLine = reply.bcc?.length ? `Bcc: ${reply.bcc.join(", ")}\r\n` : "";
  const inReplyTo = reply.inReplyTo ? `In-Reply-To: ${reply.inReplyTo}\r\n` : "";
  const refs = reply.references?.length
    ? `References: ${[...reply.references, reply.inReplyTo].filter(Boolean).join(" ")}\r\n`
    : reply.inReplyTo
      ? `References: ${reply.inReplyTo}\r\n`
      : "";

  const boundary = "stratus_ai_" + Math.random().toString(36).slice(2);

  const headers =
    `From: ${fromHeader}\r\n` +
    `To: ${to}\r\n` +
    ccLine +
    bccLine +
    `Subject: ${reply.subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `X-Stratus-AI: ${reply.marker}\r\n` +
    `Auto-Submitted: auto-replied\r\n` +
    `Precedence: bulk\r\n` +
    `X-Auto-Response-Suppress: All\r\n` +
    inReplyTo +
    refs +
    `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
    `\r\n`;

  const textPart =
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset="utf-8"\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
    reply.bodyText + `\r\n`;

  const htmlPart =
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset="utf-8"\r\n` +
    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
    reply.bodyHtml + `\r\n`;

  return headers + textPart + htmlPart + `--${boundary}--\r\n`;
}

function b64UrlEncode(s) {
  // Workers btoa expects latin1 string. UTF-8 → btoa-safe.
  const utf8 = unescape(encodeURIComponent(s));
  return btoa(utf8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
