#!/bin/bash

BASE_URL="https://stratus-ai-bot.chrisg-ec1.workers.dev/test-routing"

# Array of test inputs
declare -a INPUTS=(
  "is the MX75 good enough for 300 users"
  "can the MS225-24P do layer 3 routing"
  "does the CW9166 support WiFi 7"
  "what's the range on an MR57"
  "is MR46 indoor or outdoor"
  "how many PoE ports does MS390-24UX have"
  "what's the warranty on MV72"
  "can I stack MS225 switches"
  "does MX67 support site-to-site VPN"
  "what frequency bands does CW9164 use"
  "compare MR46 vs CW9164"
  "MX85 vs MX95 which is better for us"
  "is the MR44 worth buying or should I get CW9164"
  "what mount does the MR28 use"
  "does MS130-8P have SFP uplinks"
  "how much power does MT14 sensor need"
  "can MX67 do content filtering"
  "what's max throughput on MX250"
  "is MV22 weatherproof"
  "do I need a license for MT sensors"
)

echo "Running 20 advisory/boundary tests..."
echo ""

# Create output file
> test_results.txt

for i in "${!INPUTS[@]}"; do
  INPUT="${INPUTS[$i]}"
  ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$INPUT'''))")
  
  echo "Test $((i+1)): $INPUT"
  
  RESPONSE=$(curl -s "${BASE_URL}?input=${ENCODED}")
  
  LAYER=$(echo "$RESPONSE" | jq -r '.layer // "ERROR"' 2>/dev/null)
  MSG=$(echo "$RESPONSE" | jq -r '.response // "ERROR"' 2>/dev/null)
  FIRST_80=$(echo "$MSG" | cut -c1-80)
  
  echo "$((i+1))|$INPUT|$LAYER|$FIRST_80" >> test_results.txt
  
  echo "  Layer: $LAYER"
  echo "  Response (first 80 chars): $FIRST_80"
  echo ""
  
  # Add delay to avoid rate limiting
  sleep 0.5
done

echo "=== TEST RESULTS TABLE ==="
echo ""
echo "# | Input | Layer | First 80 chars | Expected Layer"
echo "---|-------|-------|----------------|---------------"

while IFS='|' read -r num input layer first80; do
  # Determine if should go to cf-product-info or claude (not deterministic-quote)
  if [[ "$layer" == "cf-product-info" ]] || [[ "$layer" == "claude" ]]; then
    correct="Y"
  elif [[ "$layer" == "deterministic-quote" ]]; then
    correct="N (BUG)"
  else
    correct="?"
  fi
  
  echo "$num | ${input:0:30}... | $layer | ${first80:0:40}... | $correct"
done < test_results.txt

echo ""
echo "Full results saved to test_results.txt"
