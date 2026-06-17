/**
 * Rate limits:
 *   - 1 auto-reply per thread per 24h
 *   - 3 replies per sender per day
 *   - Global Jay-CC cap: 10/day (prevent escalation pile-on)
 *
 * Codex pushed for stricter limits. POC values match the floor.
 */

export async function checkRateLimit(env, envelope) {
  const dayKey = new Date().toISOString().slice(0, 10);

  const threadKey = `rl:thread:${envelope.gmailThreadId}:${dayKey}`;
  const senderKey = `rl:sender:${envelope.fromEmail}:${dayKey}`;

  const [threadCount, senderCount] = await Promise.all([
    env.STATE_KV.get(threadKey),
    env.STATE_KV.get(senderKey),
  ]);

  const threadLimit = Number(env.RATE_LIMIT_PER_THREAD_24H || "1");
  const senderLimit = Number(env.RATE_LIMIT_PER_SENDER_DAY || "3");

  if (Number(threadCount || 0) >= threadLimit) {
    return { allowed: false, reason: `thread limit ${threadLimit}` };
  }
  if (Number(senderCount || 0) >= senderLimit) {
    return { allowed: false, reason: `sender limit ${senderLimit}` };
  }

  // Reserve a slot. Bump counters at decision time, not send time, to prevent
  // rapid duplicates within the same poll cycle.
  await Promise.all([
    env.STATE_KV.put(threadKey, String(Number(threadCount || 0) + 1), { expirationTtl: 24 * 60 * 60 }),
    env.STATE_KV.put(senderKey, String(Number(senderCount || 0) + 1), { expirationTtl: 24 * 60 * 60 }),
  ]);
  return { allowed: true };
}

export async function checkJayCcCap(env) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const key = `rl:jay-cc:${dayKey}`;
  const count = Number((await env.STATE_KV.get(key)) || 0);
  if (count >= 10) return { allowed: false };
  await env.STATE_KV.put(key, String(count + 1), { expirationTtl: 24 * 60 * 60 });
  return { allowed: true };
}
