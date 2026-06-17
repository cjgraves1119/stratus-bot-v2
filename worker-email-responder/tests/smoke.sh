#!/bin/bash
# Smoke tests against deployed worker.
# Usage: WORKER_URL=https://stratus-ai-email-responder.chrisg-ec1.workers.dev ADMIN_KEY=... bash tests/smoke.sh

set -e

: "${WORKER_URL:?WORKER_URL not set}"
: "${ADMIN_KEY:?ADMIN_KEY not set}"

echo "=== health ==="
curl -sf "$WORKER_URL/api/health" | jq .

echo ""
echo "=== state ==="
curl -sf -H "X-Admin-Key: $ADMIN_KEY" "$WORKER_URL/api/state" | jq .

echo ""
echo "=== toggle OOO off (clean state) ==="
curl -sf -X POST -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  "$WORKER_URL/api/ooo-toggle" \
  -d '{"ooo":"off","watchInbox":"off"}' | jq .

echo ""
echo "=== manual poll (ai_alias only since OOO is off) ==="
curl -sf -X POST -H "X-Admin-Key: $ADMIN_KEY" "$WORKER_URL/api/poll" | jq .

echo ""
echo "=== audit last 7 days ==="
curl -sf -H "X-Admin-Key: $ADMIN_KEY" "$WORKER_URL/api/audit?days=7&limit=10" | jq .

echo ""
echo "=== kill switch on then off (kill-switch state check) ==="
curl -sf -X POST -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  "$WORKER_URL/api/kill-switch" -d '{"state":"on"}' | jq .
curl -sf -X POST -H "X-Admin-Key: $ADMIN_KEY" "$WORKER_URL/api/poll" | jq .
curl -sf -X POST -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  "$WORKER_URL/api/kill-switch" -d '{"state":"off"}' | jq .

echo ""
echo "=== smoke tests passed ==="
