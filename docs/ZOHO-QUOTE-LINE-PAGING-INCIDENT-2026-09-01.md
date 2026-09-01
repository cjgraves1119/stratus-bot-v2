# Zoho Quote line paging incident — 2026-09-01

## Symptom

On Quote record `2570562000424802189`, the CRM bot said it had checked all 16
visible line items even though the Quote contained 18. When asked for line 18,
it said the full record read was truncated and that it could not page the
subform.

## What was actually wrong

Zoho CRM v8 returned all 18 `Quoted_Items`. There was no Zoho 16-line limit.
The Google Chat Worker serialized the full Quote correctly, then cut the tool
result at 8,000 characters with `substring()`. That cut landed inside JSON at
about line 16. The model therefore received an invalid, incomplete record and
mistook the last visible row for the end of the Quote.

The same failure could affect both the initial Claude loop and its continuation
loop. A related cache optimization could also replay page 1 when a later ranged
read was requested in the same tool batch.

## Correct fix

- `zoho_get_record` supports `line_item_start` and `line_item_limit`.
- Quote reads return `_line_item_count`, `_line_items_returned`,
  `_line_items_has_more`, and `_line_items_next_start`.
- The default Quote page contains up to 25 complete rows.
- Oversized Quote results remain valid JSON. They retain complete rows and an
  explicit continuation cursor instead of being cut mid-string.
- Ranged reads bypass both first-page search reuse and the expanded-Quote cache.
- Oversized Quote search fallback results without `Quoted_Items` retain whole
  records and continuation metadata.

## Specialist operating rule

Never claim every Quote line was reviewed unless:

1. `_line_items_returned === _line_item_count`, and
2. `_line_items_has_more === false`.

If more rows exist, call `zoho_get_record` again with
`line_item_start: _line_items_next_start` and `line_item_limit: 25`. To inspect a
specific row, request it directly; for example, line 18 is
`line_item_start: 18, line_item_limit: 1`.

Never describe transport paging as a Zoho limitation, and never infer Quote
contents from a subject, a partial JSON string, or the last visible row.

## Verification evidence

- Live read-only Zoho evidence: 18 total rows; line 18 was returned.
- Focused and adjacent regression suites: 57/57 passed.
- Adversarial specialist review: PASS after two edge cases were corrected.
- Cloudflare dry-run bundle: passed.
- Production Worker version: `d3b609f0-6997-47c7-9def-d954ca560606`.
- Git implementation commit: `4d716a8e82eb52874b2d0e1bdde560561a140ca6`.
- Production health: HTTP 200.
- All 43 pre-existing Worker bindings and both Workflow entrypoints were
  unchanged after the content-only deployment.

No live Quote fields or line items were edited while diagnosing or validating
this fix.

