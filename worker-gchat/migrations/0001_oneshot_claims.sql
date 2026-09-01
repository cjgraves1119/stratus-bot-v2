-- One-shot execute mutex (2026-07-31): one live 'executing' row per
-- idempotency key. Idempotent — safe to run repeatedly.
--
-- REQUIRED (2026-08-01): the worker does NOT create this table at runtime. If
-- the table is missing, executeOneshot fails closed with
-- error='mutex_unavailable', migration_required=true, BEFORE any CRM write.
-- Applying this migration is a mandatory deploy step.
--
-- Apply (personal DEV only, deploy-phase step — NOT run automatically):
--   npx wrangler d1 execute stratus-bot-analytics --file=migrations/0001_oneshot_claims.sql
CREATE TABLE IF NOT EXISTS oneshot_claims (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,           -- executing | succeeded | failed
  caller TEXT,
  claimed_at INTEGER NOT NULL,    -- ms epoch; stale 'executing' rows (>10 min) are reclaimable
  finished_at INTEGER
);
