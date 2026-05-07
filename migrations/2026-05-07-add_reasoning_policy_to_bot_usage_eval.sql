-- Reasoning-Off Policy: add columns to bot_usage_eval so every eval row
-- carries (a) which reasoning policy was applied (disabled / unsupported /
-- enabled_ablation / unknown), (b) whether the model supports disabling
-- reasoning, and (c) the raw control descriptor for debugging.
--
-- The worker-side D1 logger (logBotUsageToD1) attempts an INSERT against
-- the new schema first and falls back to the legacy column set on
-- "no such column" errors, so this migration can be applied in any order
-- relative to the worker deploy.

ALTER TABLE bot_usage_eval ADD COLUMN reasoning_policy TEXT;
ALTER TABLE bot_usage_eval ADD COLUMN reasoning_disable_supported INTEGER;  -- 0/1 boolean
ALTER TABLE bot_usage_eval ADD COLUMN reasoning_control_json TEXT;

-- Index reasoning_policy so per-policy ablation queries are fast.
CREATE INDEX IF NOT EXISTS idx_bot_usage_eval_reasoning_policy
  ON bot_usage_eval (reasoning_policy);
