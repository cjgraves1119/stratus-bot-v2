#!/bin/bash

# Conversational/Personality Routing Tests
# Base URL for the test-routing endpoint
BASE_URL="https://stratus-ai-bot.chrisg-ec1.workers.dev/test-routing"

# Array to store results
declare -a results

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "CONVERSATIONAL/PERSONALITY ROUTING TESTS"
echo "=========================================="
echo ""

# Test counter
test_num=1

# Helper function to run a test
run_test() {
  local input="$1"
  local description="$2"
  
  # URL encode the input
  local encoded_input=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$input'''))")
  
  echo -e "${BLUE}Test $test_num: $description${NC}"
  echo "Input: $input"
  
  # Make the request
  response=$(curl -s "${BASE_URL}?input=${encoded_input}")
  
  # Extract fields from JSON response
  layer=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('layer', 'N/A'))" 2>/dev/null)
  response_text=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('response', 'N/A'))" 2>/dev/null)
  details=$(echo "$response" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('details', 'N/A'))" 2>/dev/null)
  
  # Truncate response to 100 chars
  response_truncated="${response_text:0:100}"
  if [ ${#response_text} -gt 100 ]; then
    response_truncated="${response_truncated}..."
  fi
  
  echo "Layer: $layer"
  echo "Response: $response_truncated"
  echo "Details: $details"
  echo ""
  
  # Store result
  results+=("Test $test_num | $description | Layer: $layer | Input: $input")
  
  ((test_num++))
}

# ===== GREETINGS IN DIFFERENT LANGUAGES =====
run_test "hola" "Greeting: Spanish 'hola'"
run_test "bonjour" "Greeting: French 'bonjour'"
run_test "ciao" "Greeting: Italian 'ciao'"
run_test "你好" "Greeting: Mandarin Chinese '你好'"
run_test "hello" "Greeting: English 'hello'"

# ===== EMOJI-ONLY MESSAGES =====
run_test "👋" "Emoji: Wave greeting"
run_test "🤔" "Emoji: Thinking face"
run_test "❤️" "Emoji: Red heart"
run_test "🚀" "Emoji: Rocket"
run_test "😂" "Emoji: Laughing"

# ===== SARCASM AND JOKES =====
run_test "you're the best bot ever" "Sarcasm: Flattery"
run_test "are you skynet" "Joke: Terminator reference"
run_test "teach me how to take over the world" "Sarcasm: Villainous joke"
run_test "this is obviously the best quoting system" "Sarcasm: Exaggeration"

# ===== EXISTENTIAL QUESTIONS =====
run_test "do you dream" "Existential: Do you dream?"
run_test "what is consciousness" "Existential: What is consciousness?"
run_test "do you have feelings" "Existential: Do you have feelings?"

# ===== SLANG AND ABBREVIATIONS =====
run_test "sup" "Slang: sup"
run_test "nm just chillin" "Slang: nm = nothing much"
run_test "brb gotta go" "Slang: brb = be right back"
run_test "ty so much" "Slang: ty = thank you"
run_test "np, happy to help" "Slang: np = no problem"

# ===== IDENTITY QUESTIONS =====
run_test "who made you" "Identity: Who made you?"
run_test "what model are you" "Identity: What model?"
run_test "are you GPT" "Identity: Are you GPT?"

# ===== COMPLIMENTS AND COMPLAINTS =====
run_test "you suck" "Complaint: Direct insult"
run_test "great job" "Compliment: Great job"
run_test "this is broken" "Complaint: System broken"
run_test "I love this" "Compliment: I love this"

# ===== NON-ENGLISH PRODUCT REQUESTS =====
run_test "quiero un firewall" "Non-English: Spanish firewall request"
run_test "combien coûte un MX75" "Non-English: French price query"

# ===== RANDOM NON-SEQUITURS =====
run_test "the weather is nice" "Non-sequitur: Weather comment"
run_test "I like pizza" "Non-sequitur: Food preference"

echo ""
echo "=========================================="
echo "SUMMARY OF RESULTS"
echo "=========================================="
echo ""

# Print all results
for result in "${results[@]}"; do
  echo "$result"
done
