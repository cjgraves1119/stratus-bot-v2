-- Audit log for the AI email responder.
-- Every envelope produces exactly one row regardless of outcome.
-- Lives in stratus-bot-analytics (shared with rest of bot stack).

CREATE TABLE IF NOT EXISTS email_ai_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                       -- ISO8601
  path TEXT NOT NULL,                     -- ai_alias | chris_ooo
  gmail_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT,
  received_at TEXT,                       -- internalDate from Gmail
  match_level TEXT,                       -- exact_contact | single_account_domain | multi_domain | free_email | no_match
  intent TEXT,
  confidence REAL,
  decision_action TEXT,                   -- auto_send | draft_for_review | escalate_to_jay | no_reply
  decision_handler TEXT,
  decision_reason TEXT,
  send_mode TEXT,                         -- dry_run | draft_only | auto_send (active mode at time of decision)
  outcome TEXT,                           -- duplicate | skipped | rate_limited | dry_run_logged | drafted | sent | send_failed | handler_error | no_reply
  reason TEXT,
  reply_subject TEXT,
  reply_preview TEXT,                     -- first 200 chars of reply body (for trace + GDPR redaction later)
  cc_jay INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_email_ai_audit_ts ON email_ai_audit(ts);
CREATE INDEX IF NOT EXISTS idx_email_ai_audit_thread ON email_ai_audit(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_ai_audit_from ON email_ai_audit(from_email);
CREATE INDEX IF NOT EXISTS idx_email_ai_audit_outcome ON email_ai_audit(outcome);
CREATE INDEX IF NOT EXISTS idx_email_ai_audit_intent ON email_ai_audit(intent);
