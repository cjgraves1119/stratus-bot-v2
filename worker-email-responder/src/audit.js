/**
 * Audit log → D1 table email_ai_audit on stratus-bot-analytics.
 * Every envelope produces exactly one row, regardless of outcome.
 *
 * Query endpoint (admin only): /api/audit?days=7
 */

export async function writeAudit(env, row) {
  try {
    await env.ANALYTICS_DB.prepare(`
      INSERT INTO email_ai_audit (
        ts, path, gmail_message_id, thread_id, from_email, subject, received_at,
        match_level, intent, confidence,
        decision_action, decision_handler, decision_reason,
        send_mode, outcome, reason, reply_subject, reply_preview, cc_jay
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      new Date().toISOString(),
      row.path || "",
      row.gmailMessageId || "",
      row.threadId || "",
      row.fromEmail || "",
      (row.subject || "").slice(0, 500),
      row.receivedAt || "",
      row.match_level || "",
      row.intent || "",
      row.confidence ?? null,
      row.decision_action || "",
      row.decision_handler || "",
      (row.decision_reason || "").slice(0, 500),
      row.send_mode || env.SEND_MODE || "",
      row.outcome || "",
      (row.reason || "").slice(0, 500),
      (row.reply_subject || "").slice(0, 500),
      (row.reply_preview || "").slice(0, 500),
      row.cc_jay ? 1 : 0,
    ).run();
  } catch (err) {
    console.error(`[audit] write failed: ${err.message}`);
  }
}

export async function auditQuery(req, env) {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7)));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 100)));

  const result = await env.ANALYTICS_DB.prepare(`
    SELECT ts, path, from_email, subject, intent, confidence,
           decision_action, outcome, send_mode, cc_jay
    FROM email_ai_audit
    WHERE ts > ?
    ORDER BY ts DESC
    LIMIT ?
  `).bind(cutoff, limit).all();

  return new Response(JSON.stringify(result.results || [], null, 2), {
    headers: { "content-type": "application/json" },
  });
}
