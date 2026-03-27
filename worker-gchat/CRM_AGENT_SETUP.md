# Google Chat Bot — CRM & Email Agent (POC Setup Guide)

## Overview

This update adds Zoho CRM and Gmail tool-use capabilities to the Google Chat bot.
When a user sends a message with CRM or email intent (e.g., "look up the Acme Corp deal",
"search my email for the quote request from John"), Claude is given tools to directly
query Zoho CRM and Gmail, operating in an agentic loop until it produces a final response.

The existing deterministic quoting engine is completely untouched. CRM/email tools
only activate when intent is detected AND the required OAuth credentials are configured.

## What's New

- **Zoho CRM Tools**: search_records, get_record, create_record, update_record, get_related_records, get_field (picklist validation), coql_query
- **Gmail Tools**: search_messages, read_message, read_thread, create_draft, send_email
- **Agentic Loop**: Claude can call multiple tools in sequence (up to 8 iterations) before returning a final text response
- **Intent Detection**: Automatic routing — quoting requests still go through the deterministic engine; CRM/email requests get tool access
- **Graceful Degradation**: If OAuth credentials aren't configured, the bot works exactly as before (quoting only)

## Required Secrets

Set these via `wrangler secret put <NAME>` in the `worker-gchat` directory:

### Zoho CRM OAuth

1. Go to [api-console.zoho.com](https://api-console.zoho.com)
2. Create a **Self Client** (if you don't already have one)
3. Generate a grant token with these scopes:
   ```
   ZohoCRM.modules.ALL,ZohoCRM.settings.fields.ALL,ZohoCRM.coql.READ
   ```
4. Exchange the grant token for a refresh token
5. Set the secrets:

```bash
cd worker-gchat
wrangler secret put ZOHO_CLIENT_ID
wrangler secret put ZOHO_CLIENT_SECRET
wrangler secret put ZOHO_REFRESH_TOKEN
```

### Gmail API OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Use existing GCP project: `swift-catfish-474413-d5`
3. Enable the **Gmail API** if not already enabled
4. Under **Credentials**, create an **OAuth 2.0 Client ID** (type: Web Application)
5. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI
6. Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
7. Click the gear icon, check "Use your own OAuth credentials", enter client ID and secret
8. Authorize these scopes:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.compose
   https://www.googleapis.com/auth/gmail.send
   ```
9. Exchange authorization code for tokens — copy the **refresh token**
10. Set the secrets:

```bash
cd worker-gchat
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN
```

## How It Works

### Message Flow

```
User sends message in Google Chat
  |
  +-- Deterministic engine tries first (quotes, pricing, EOL)
  |     +-- If handled → return immediately (zero API cost)
  |
  +-- If not handled → detect CRM/email intent
  |     +-- CRM keywords: "deal", "quote", "task", "account", "customer", "zoho", "crm"
  |     +-- Email keywords: "email", "draft", "inbox", "gmail", "reply"
  |
  +-- If CRM/email intent AND credentials configured → askClaude(useTools=true)
  |     +-- System prompt includes CRM business rules
  |     +-- Claude given 12 tools (7 Zoho, 5 Gmail)
  |     +-- Agentic loop: Claude calls tools → worker executes → results back to Claude
  |     +-- Max 8 iterations before forcing a text response
  |
  +-- If no CRM intent OR no credentials → askClaude(useTools=false)
        +-- Standard Claude fallback (quoting assistance only)
```

### Token Caching

OAuth access tokens are cached in Cloudflare KV with 50-minute TTL (tokens expire at 60 min).
This means at most one token refresh per hour regardless of request volume.

### Cost Implications

- **Deterministic requests (quotes, pricing)**: $0 (no API call)
- **Simple CRM lookup** (1-2 tool calls): ~$0.01-0.03 (Sonnet, ~3K tokens)
- **Complex CRM operation** (4-6 tool calls): ~$0.05-0.10 (Sonnet, ~8K tokens)
- **Email search + draft** (3-4 tool calls): ~$0.03-0.05

## Example Interactions

### CRM Lookup
```
User: "When was the last time Springfield USD bought from us?"
Bot: [calls zoho_search_records for Accounts] → [calls zoho_search_records for Deals] →
     "Springfield USD last purchased on Jan 15, 2026 — Deal: Springfield USD MS150 Refresh
      ($45,200, Closed Won). Link: https://crm.zoho.com/crm/org647122552/tab/Deals/12345"
```

### Email Search
```
User: "Find the email from John at Acme about the license renewal"
Bot: [calls gmail_search_messages] → [calls gmail_read_message] →
     "Found it — John Baker (john@acmecorp.com) emailed on March 20th about renewing
      their MR44 licenses. He's asking for a 3-year renewal quote for 25 APs.
      Want me to create a quote for that?"
```

### Deal Creation
```
User: "Create a deal for Riverside Medical, 10 MR46 APs, Stratus referral"
Bot: [calls zoho_search_records for Account] → [calls zoho_get_field for Stage validation] →
     [calls zoho_create_record for Deal] →
     "Deal created: Riverside Medical MR46 Deployment
      Stage: Qualification | Lead Source: Stratus Referal
      Link: https://crm.zoho.com/crm/org647122552/tab/Deals/67890"
```

## Limitations (POC)

- **No computer use / browser automation**: CCW submission and browser-based workflows aren't possible through Google Chat
- **Google Chat character limit**: Responses truncated at ~4000 chars. Complex outputs may be cut off.
- **Single user auth**: OAuth tokens are for one account (Chris). Multi-user support would require per-user token management.
- **No email sending without approval**: The bot creates drafts by default. Direct sending requires the user to explicitly approve.
- **Synchronous processing**: Google Chat expects a response within 30 seconds. Complex multi-tool operations may time out.

## Deploy

After setting secrets:

```bash
cd worker-gchat
CLOUDFLARE_API_TOKEN=cfut_mdGEfjYouFvngAqpuloxYvGwxUjVXmzquHqvEo7E7bc0b83e npx wrangler deploy
```
