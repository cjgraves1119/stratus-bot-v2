# Stratus AI Gmail Add-on — Setup Guide

## Overview

The Stratus AI Gmail Add-on runs as a sidebar in Gmail that automatically:
- Summarizes emails with urgency scoring and action items
- Detects Cisco/Meraki SKUs in emails and generates Stratus URL quotes
- Looks up senders in Zoho CRM (account, deals, contacts)
- Drafts context-aware replies in Chris's voice
- Provides a quick quote builder for manual SKU entry

The add-on calls the Stratus AI GChat Cloudflare Worker (`/api/*` endpoints) as its backend.

## Prerequisites

- Google Workspace account (chrisg@stratusinfosystems.com)
- GCP Project: `swift-catfish-474413-d5`
- Worker API key: `stratus-gao-55688852246aaea36c36b49f7a35c8f2`
  (already set as `GMAIL_ADDON_API_KEY` secret on the worker)

## Step 1: Create the Apps Script Project

1. Go to https://script.google.com
2. Click **New project**
3. Rename it to "Stratus AI Gmail Add-on"

## Step 2: Create the Script Files

Delete the default `Code.gs` content, then create these files:

| File | Source |
|------|--------|
| `Code.gs` | Copy from `gmail-addon/Code.gs` |
| `Cards.gs` | Copy from `gmail-addon/Cards.gs` |
| `Api.gs` | Copy from `gmail-addon/Api.gs` |
| `Config.gs` | Copy from `gmail-addon/Config.gs` |

To create additional files: click the **+** next to Files, select **Script**, and name it (without `.gs` extension).

## Step 3: Update the Manifest

1. In the Apps Script editor, click the gear icon (Project Settings)
2. Check **Show "appsscript.json" manifest file in editor**
3. Click back to the Editor tab
4. Open `appsscript.json` and replace its contents with `gmail-addon/appsscript.json`

## Step 4: Set the API Key

1. Click the gear icon (Project Settings)
2. Scroll to **Script Properties**
3. Click **Add script property**
4. Property: `STRATUS_API_KEY`
5. Value: `stratus-gao-55688852246aaea36c36b49f7a35c8f2`
6. Click **Save**

## Step 5: Link to GCP Project

1. In Project Settings, find **Google Cloud Platform (GCP) Project**
2. Click **Change project**
3. Enter project number: `199133237913` (swift-catfish-474413-d5)
4. Click **Set project**

## Step 6: Deploy as Test

1. Click **Deploy** > **Test deployments**
2. Under **Application(s)**, select **Gmail Add-on**
3. Click **Install** (this installs for your account only)
4. Open Gmail in a new tab
5. Look for the Stratus icon in the right sidebar

## Step 7: Verify

1. Open any email in Gmail
2. Click the Stratus icon in the sidebar
3. You should see: email summary, sender info, action buttons
4. Try "Quick Quote" with `10 MR44`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "STRATUS_API_KEY not set" | Add the API key in Script Properties (Step 4) |
| "Unauthorized" error | Verify the API key matches the worker secret |
| Sidebar doesn't appear | Ensure test deployment is installed (Step 6) |
| CRM lookups fail | Worker needs valid Zoho tokens (check `/_prices-status`) |
| Slow first load | Normal, Apps Script cold start takes 2-3 seconds |

## Architecture

```
Gmail (sidebar)
  |
  +-- Apps Script (Card Service UI)
        |
        +-- HTTPS POST to worker /api/* endpoints
              |
              +-- /api/analyze-email  (summary + SKU detect + CRM lookup)
              +-- /api/draft-reply    (AI reply generation via Claude)
              +-- /api/quote          (URL quote via quoting engine)
              +-- /api/crm-search     (Zoho CRM search)
              +-- /api/detect-skus    (SKU detection in text)
```

## API Endpoints Reference

All endpoints require `X-API-Key` header and accept POST with JSON body.

| Endpoint | Input | Output |
|----------|-------|--------|
| `/api/analyze-email` | subject, body, senderEmail, senderName | summary, urgency, actionItems, detectedSkus, crmAccount |
| `/api/draft-reply` | subject, body, senderEmail, senderName, tone, instructions | drafts[] (2 options) |
| `/api/quote` | text (SKU string) | quoteUrls[], eolWarnings[], parsedItems[] |
| `/api/crm-search` | query, module (Accounts/Contacts/Deals/Quotes) | records[] |
| `/api/detect-skus` | text | skus[] ({sku, qty}) |
