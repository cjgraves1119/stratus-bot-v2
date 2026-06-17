/**
 * Dedupe by the (Gmail message id, RFC Message-ID, thread id) triple.
 * Any one matching a prior tick marks the envelope as duplicate.
 * KV TTL = 7 days.
 */

const TTL_SEC = 7 * 24 * 60 * 60;

export async function checkAndMarkSeen(env, envelope) {
  const keys = [
    `seen:gm:${envelope.gmailMessageId}`,
    envelope.rfcMessageId ? `seen:rfc:${normalizeMsgId(envelope.rfcMessageId)}` : null,
  ].filter(Boolean);

  for (const k of keys) {
    if (await env.STATE_KV.get(k)) {
      return { duplicate: true, hitKey: k };
    }
  }
  for (const k of keys) {
    await env.STATE_KV.put(k, "1", { expirationTtl: TTL_SEC });
  }
  return { duplicate: false };
}

function normalizeMsgId(id) {
  return id.replace(/^<|>$/g, "").trim().toLowerCase();
}
