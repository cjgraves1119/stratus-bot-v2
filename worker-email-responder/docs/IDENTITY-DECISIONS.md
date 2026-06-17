# Identity & Send-As Decisions

Codex flagged "identity intentionally" as a high-burn risk. This doc records what we chose and why.

## Decision matrix

| Aspect | AI alias path | Chris OOO path |
|---|---|---|
| **From email** | `ai@stratusinfosystems.com` | `chrisg@stratusinfosystems.com` |
| **From display name** | `Stratus AI Assistant` | `Chris Graves` |
| **Subject prefix** | (none — original subject only) | `[Auto-reply via Stratus AI] Re: ...` |
| **Top-of-body banner** | (none) | Mandatory, unmissable |
| **Disclosure footer** | Italic line | Italic line |
| **BCC Chris** | No | Yes (every reply) |
| **Reply-To** | Same as From | Same as From |
| **Custom From header** | `X-Stratus-AI: x-stratus-ai-msg-v1` | Same |

## Why "Chris Graves" From for OOO path (not "Stratus AI on behalf of Chris")

Considered but rejected:
- `Chris Graves (via Stratus AI) <chrisg@>` — Gmail / many clients strip parenthetical and just show "Chris Graves"
- `Stratus AI <chrisg@>` — confusing, makes it look like Chris's address belongs to a bot
- `Chris Graves <ai+chris@stratusinfosystems.com>` — different email address breaks reply-routing to Chris's actual mailbox

Settled on `Chris Graves <chrisg@>` BECAUSE:
1. Customer reads the From field as expected (replies route to Chris)
2. The subject prefix and top banner together make AI involvement loud
3. Body footer doubles down on the disclosure
4. Chris is BCC'd, so he sees every send

If legal review later demands a stricter pattern (e.g., Gmail "via" header), it's a one-line change in `reply-builder.js → signatureBlock()` and `sender.js → buildMime()`.

## Why "Stratus AI Assistant" not "Stratus Sales Assistant"

The word "Sales" implies pressure / pitch. "Assistant" is calmer and matches the actual scope — help with quote URLs, licensing FAQs, order status. Not "close the deal."

## Disclosure visibility budget

Three places where AI involvement is disclosed:

1. **Subject prefix** (OOO path only) — caught even in inbox previews
2. **Top-of-body banner** (OOO path only) — first thing customer sees opening the reply
3. **Body footer** (both paths) — italicized, present even on auto-send

For the AI alias path, the From display name `Stratus AI Assistant` is itself disclosure. The footer reinforces.

## What we will NOT do (Codex flag)

- Bury the disclosure at the bottom of a long reply (banner at top for OOO is mandatory)
- Send as Chris without his BCC — every OOO reply BCCs him for transparency
- Use Chris's display name on the AI alias path — that would be impersonation
- Mix the two paths (e.g., AI alias replying as Chris) — they're separate by design

## Gmail send-as setup required (dev finishes)

The worker uses two Gmail refresh tokens:
- `GOOGLE_REFRESH_TOKEN_AI` — for `ai@stratusinfosystems.com` mailbox
- `GOOGLE_REFRESH_TOKEN_CHRIS` — for `chrisg@stratusinfosystems.com` mailbox

OAuth client uses scopes: `gmail.readonly` + `gmail.compose` + `gmail.send`. Same OAuth client ID can serve both — separate refresh tokens issued for each Workspace user.

Workspace admin actions required:
1. Create `ai@stratusinfosystems.com` as a real mailbox (not just an alias)
2. Authorize the OAuth client app in Workspace admin (Domain Wide Delegation OR per-user OAuth — dev decides; per-user is simpler for POC)
3. For Chris's mailbox: same OAuth flow, run from Chris's account to issue `GOOGLE_REFRESH_TOKEN_CHRIS`
4. (Optional) Set up `ai@` as a Send-As alias on Chris's mailbox if we ever need cross-routing

## Reply-To behavior

- Both paths set `Reply-To` to the same address as `From`
- Customer "replies" go back to the bot's inbox, which gets ingested by the next poll cycle
- Loop guard catches `From: ai@` self-loop AND `Jay on thread` patterns
- If customer replies with "human please" — that's still ingested; classifier should detect and escalate

## "Human please" routing

Implementation note: the classifier handles intent. We can add a deterministic short-circuit rule:

```javascript
if (/\bhuman please\b/i.test(envelope.bodyText)) {
  // Skip classifier, go straight to escalation
  return { handler: "escalation", reason: "human please marker" };
}
```

POC doesn't ship this short-circuit (classifier should handle it via routing_acknowledgment intent), but it's a one-liner to add in `pipeline.js` if it misclassifies.
