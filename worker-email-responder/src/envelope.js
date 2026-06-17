/**
 * Normalize a Gmail API message into a canonical Envelope for the pipeline.
 * We never trust display names — only email addresses.
 */

export function parseEnvelope(gmailMsg, { path, recipient }) {
  const headers = headerMap(gmailMsg.payload?.headers || []);
  const fromEmail = extractEmail(headers["from"]);
  const senderDomain = fromEmail?.split("@")[1]?.toLowerCase() || "";
  const toList = parseAddrList(headers["to"]);
  const ccList = parseAddrList(headers["cc"]);
  const body = extractBody(gmailMsg.payload);

  return {
    path,                                  // ai_alias | chris_ooo
    recipient,                             // the mailbox we polled
    gmailMessageId: gmailMsg.id,
    gmailThreadId: gmailMsg.threadId,
    rfcMessageId: headers["message-id"] || "",
    inReplyTo: headers["in-reply-to"] || "",
    references: (headers["references"] || "").split(/\s+/).filter(Boolean),
    fromEmail,
    fromName: extractName(headers["from"]),
    senderDomain,
    to: toList,
    cc: ccList,
    subject: headers["subject"] || "",
    autoSubmitted: headers["auto-submitted"] || "",
    precedence: headers["precedence"] || "",
    listId: headers["list-id"] || "",
    listUnsubscribe: headers["list-unsubscribe"] || "",
    xAutoResponseSuppress: headers["x-auto-response-suppress"] || "",
    returnPath: headers["return-path"] || "",
    contentType: headers["content-type"] || "",
    deliveredTo: headers["delivered-to"] || "",
    receivedHeaders: (gmailMsg.payload?.headers || []).filter(h => /^received$/i.test(h.name)).map(h => h.value),
    internalDateMs: Number(gmailMsg.internalDate || 0),
    snippet: gmailMsg.snippet || "",
    bodyText: body,
    labelIds: gmailMsg.labelIds || [],
    hasAttachments: hasAttachments(gmailMsg.payload),
  };
}

function headerMap(headers) {
  const m = {};
  for (const h of headers) m[h.name.toLowerCase()] = h.value;
  return m;
}

function extractEmail(field) {
  if (!field) return null;
  const m = field.match(/<([^>]+)>/);
  if (m) return m[1].toLowerCase();
  // No angle brackets — assume bare address
  const m2 = field.match(/\S+@\S+/);
  return m2 ? m2[0].toLowerCase() : null;
}

function extractName(field) {
  if (!field) return "";
  const m = field.match(/^([^<]+)</);
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
}

function parseAddrList(field) {
  if (!field) return [];
  return field.split(",").map(extractEmail).filter(Boolean);
}

function hasAttachments(part) {
  if (!part) return false;
  if (part.filename) return true;
  for (const p of part.parts || []) if (hasAttachments(p)) return true;
  return false;
}

function extractBody(part) {
  if (!part) return "";
  // Prefer text/plain. If only text/html, strip tags.
  const plain = findPart(part, "text/plain");
  if (plain) return stripQuoted(decode(plain.body?.data || ""));
  const html = findPart(part, "text/html");
  if (html) return stripQuoted(stripHtml(decode(html.body?.data || "")));
  return "";
}

function findPart(part, mime) {
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts || []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function decode(b64) {
  if (!b64) return "";
  try {
    const fixed = b64.replace(/-/g, "+").replace(/_/g, "/");
    const padded = fixed + "===".slice((fixed.length + 3) % 4);
    return atob(padded);
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Strip quoted thread history. Naive but adequate for POC. Cuts at:
 *   - "On <date>, <name> wrote:" pattern
 *   - lines starting with ">"
 *   - "-----Original Message-----"
 */
function stripQuoted(text) {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^-----\s*Original Message\s*-----/i.test(line)) break;
    if (/^On .+wrote:\s*$/.test(line)) break;
    if (/^>+/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}
