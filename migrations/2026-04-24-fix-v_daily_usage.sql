-- Migration: rebuild v_daily_usage view
-- Date: 2026-04-24
-- Context: 2026-04-24 ecosystem review found that v_daily_usage references
--          main.bot_usage_old (dropped during an earlier migration), so any
--          dashboard query that hit it failed with "no such table".
-- Target:  D1 database stratus-bot-analytics (id d4c3c112-e36b-4484-ac15-cbd848fa77fb)
--
-- Apply with:
--   source /Users/chrisgraves/Documents/Claude/Projects/Bots/.stratus-secrets
--   cd stratus-bot-v2-cf
--   CLOUDFLARE_API_TOKEN="$STRATUS_CF_API_TOKEN" \
--     npx wrangler d1 execute stratus-bot-analytics \
--       --remote \
--       --file=migrations/2026-04-24-fix-v_daily_usage.sql
--
-- Safety: DROP VIEW IF EXISTS is idempotent. The view is read-only so no
-- data is affected. Rollback = drop the view (dashboards fall back to
-- direct SELECTs against bot_usage).

DROP VIEW IF EXISTS v_daily_usage;

CREATE VIEW v_daily_usage AS
SELECT
  date(created_at)            AS day,
  COALESCE(bot, 'unknown')    AS bot,
  COALESCE(response_path, '') AS response_path,
  COALESCE(model, '')         AS model,
  COUNT(*)                    AS requests,
  SUM(COALESCE(input_tokens, 0))  AS input_tokens,
  SUM(COALESCE(output_tokens, 0)) AS output_tokens,
  SUM(COALESCE(cost_usd, 0))      AS cost_usd,
  AVG(duration_ms)                AS avg_duration_ms,
  SUM(CASE WHEN error_message IS NOT NULL AND error_message != '' THEN 1 ELSE 0 END) AS errors
FROM bot_usage
GROUP BY date(created_at), bot, response_path, model;

-- Sanity check — should return at least 1 row if bot_usage has any data.
-- Comment out before committing to migration; leaving as trailing verification.
-- SELECT * FROM v_daily_usage ORDER BY day DESC LIMIT 5;
