#!/bin/bash
#
# Stratus Bot Sync Engine
#
# Synchronizes shared data files and checks function signature consistency
# between the Webex bot (worker/) and Google Chat bot (worker-gchat/)
#
# Usage: bash sync-engine.sh [--sync]
#   Without flags: Show diff summary only
#   --sync:       Copy data files from worker/src/data/ to worker-gchat/src/data/

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

WEBEX_DATA="worker/src/data"
GCHAT_DATA="worker-gchat/src/data"

# Data files to sync
DATA_FILES=("prices.json" "auto-catalog.json" "specs.json" "accessories.json")

echo "=========================================="
echo "Stratus Bot Sync Engine"
echo "=========================================="
echo ""

# Check if both directories exist
if [ ! -d "$WEBEX_DATA" ]; then
  echo "ERROR: $WEBEX_DATA not found"
  exit 1
fi

if [ ! -d "$GCHAT_DATA" ]; then
  echo "ERROR: $GCHAT_DATA not found"
  exit 1
fi

# Show data file diffs
echo "[1/2] Checking data file synchronization..."
echo ""

DATA_SYNC_NEEDED=0
for file in "${DATA_FILES[@]}"; do
  webex_file="$WEBEX_DATA/$file"
  gchat_file="$GCHAT_DATA/$file"

  if [ ! -f "$webex_file" ]; then
    echo "  ⚠️  $file not in webex worker"
    continue
  fi

  if [ ! -f "$gchat_file" ]; then
    echo "  ❌ $file missing in gchat worker (will be copied on --sync)"
    DATA_SYNC_NEEDED=1
    continue
  fi

  if diff -q "$webex_file" "$gchat_file" > /dev/null 2>&1; then
    echo "  ✓ $file synchronized"
  else
    echo "  ❌ $file differs between workers"
    DATA_SYNC_NEEDED=1
    # Show brief diff
    echo "     Lines added in webex:"
    diff "$webex_file" "$gchat_file" 2>/dev/null | grep "^<" | head -2 || true
    echo "     Lines added in gchat:"
    diff "$webex_file" "$gchat_file" 2>/dev/null | grep "^>" | head -2 || true
  fi
done

echo ""

# Extract function signatures for comparison
echo "[2/2] Checking function signature consistency..."
echo ""

# Create temp files with function signatures
WEBEX_SIGS=$(mktemp)
GCHAT_SIGS=$(mktemp)

# Extract function declarations from both workers
grep -E "^function |^const .* = \(|^const .* = function" \
  worker/src/index.js | sed 's/{.*//' | sort > "$WEBEX_SIGS" 2>/dev/null || true

grep -E "^function |^const .* = \(|^const .* = function" \
  worker-gchat/src/index.js | sed 's/{.*//' | sort > "$GCHAT_SIGS" 2>/dev/null || true

# Compare function signatures
if diff -q "$WEBEX_SIGS" "$GCHAT_SIGS" > /dev/null 2>&1; then
  echo "  ✓ Function signatures match"
else
  echo "  ⚠️  Function signatures differ between workers"
  echo ""
  echo "    Functions in Webex only:"
  diff "$WEBEX_SIGS" "$GCHAT_SIGS" 2>/dev/null | grep "^<" | head -5 || echo "      (none)"
  echo ""
  echo "    Functions in GChat only:"
  diff "$WEBEX_SIGS" "$GCHAT_SIGS" 2>/dev/null | grep "^>" | head -5 || echo "      (none)"
fi

# Clean up temp files
rm -f "$WEBEX_SIGS" "$GCHAT_SIGS"

echo ""
echo "=========================================="

# Handle --sync flag
if [ "$1" == "--sync" ]; then
  echo ""
  echo "Syncing data files..."
  for file in "${DATA_FILES[@]}"; do
    webex_file="$WEBEX_DATA/$file"
    gchat_file="$GCHAT_DATA/$file"

    if [ -f "$webex_file" ]; then
      cp "$webex_file" "$gchat_file"
      echo "  ✓ Copied $file"
    fi
  done
  echo ""
  echo "Data files synchronized!"
  exit 0
fi

# Exit with status based on data sync needed
if [ $DATA_SYNC_NEEDED -eq 1 ]; then
  echo ""
  echo "⚠️  Data files are out of sync. Run: bash sync-engine.sh --sync"
  exit 1
else
  echo ""
  echo "✓ All checks passed!"
  exit 0
fi
