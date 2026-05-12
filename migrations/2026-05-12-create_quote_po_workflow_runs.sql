-- Migration: create quote_po_workflow_runs table for QuotePoWorkflow telemetry
-- Date: 2026-05-12
-- Context: Phase 3 of the quote-to-PO/esign rebuild ships a Cloudflare Workflow
--          (QuotePoWorkflow) that wraps the existing handleQuoteToPoAndEsign
--          synchronous orchestrator. This table records one row per workflow run
--          (start + terminal update) so we can diagnose failures by workflow_id
--          rather than spelunking through bot_usage. Isolated by design — do NOT
--          overload bot_usage with workflow telemetry.
-- Target:  D1 database stratus-bot-analytics (id d4c3c112-e36b-4484-ac15-cbd848fa77fb)
--
-- Apply with:
--   source /Users/chrisgraves/Documents/Claude/Projects/Bots/.stratus-secrets
--   cd stratus-bot-v2-cf
--   CLOUDFLARE_API_TOKEN="$STRATUS_CF_API_TOKEN" \
--     npx wrangler d1 execute stratus-bot-analytics \
--       --remote \
--       --file=migrations/2026-05-12-create_quote_po_workflow_runs.sql
--
-- Safety: CREATE TABLE IF NOT EXISTS is idempotent. No existing data touched.
-- Rollback: DROP TABLE quote_po_workflow_runs; (logger fails silently when missing)

CREATE TABLE IF NOT EXISTS quote_po_workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  quote_id TEXT,
  person_id TEXT,
  status TEXT NOT NULL,             -- 'started' | 'success' | 'error' | 'timeout' | 'disabled'
  error_message TEXT,
  duration_ms INTEGER,
  result_summary TEXT,              -- truncated JSON payload (4000 chars)
  sales_order_id TEXT,
  created_po INTEGER DEFAULT 0,     -- boolean
  esign_sent INTEGER DEFAULT 0,     -- boolean
  caller_source TEXT,               -- 'extension' | 'gchat' | 'api' | 'unknown'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qpo_workflow_runs_workflow_id
  ON quote_po_workflow_runs(workflow_id);

CREATE INDEX IF NOT EXISTS idx_qpo_workflow_runs_status_created
  ON quote_po_workflow_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_qpo_workflow_runs_quote_id
  ON quote_po_workflow_runs(quote_id);
