-- Live waterfall eval telemetry.
-- This table keeps synthetic eval traffic out of customer-facing bot_usage
-- reports while preserving the real endpoint/model evidence needed for
-- Llama/Gemma/Claude waterfall decisions.
CREATE TABLE IF NOT EXISTS bot_usage_eval (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  eval_run_id TEXT NOT NULL,
  bot TEXT,
  person_id TEXT,
  request_text TEXT,
  response_path TEXT,
  model TEXT,
  requested_model TEXT,
  executed_model TEXT,
  tier_path TEXT,
  live_llm_call BOOLEAN,
  tier_0_deterministic BOOLEAN,
  attempts INTEGER DEFAULT 1,
  transient_errors TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  response_text TEXT,
  tool_calls_json TEXT,
  endpoint TEXT
);

CREATE INDEX IF NOT EXISTS idx_bot_usage_eval_run ON bot_usage_eval(eval_run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_usage_eval_model ON bot_usage_eval(executed_model, created_at);
CREATE INDEX IF NOT EXISTS idx_bot_usage_eval_path ON bot_usage_eval(response_path, created_at);
