/**
 * Shared tool executor. Both runners dispatch through this so the destructive
 * surface is identical. dryRun routes writes to deterministic mocks.
 */

const FIXTURE_RESPONSES = {};

export async function executeTool({ name, input, env, dryRun }) {
  if (isDestructive(name)) return executeDestructive({ name, input, env, dryRun });
  return executeRead({ name, input, env, dryRun });
}

async function executeRead({ name, input, env, dryRun }) {
  if (env?.GCHAT_URL && env?.GCHAT_AUTH) {
    try {
      const res = await fetch(`${env.GCHAT_URL}/api/bench-tool`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bench-auth': env.GCHAT_AUTH },
        body: JSON.stringify({ name, input, dry_run: dryRun })
      });
      if (!res.ok) return { success: false, error: `gchat ${res.status}`, fallback: 'fixture' };
      return await res.json();
    } catch (err) { /* fall through */ }
  }
  const key = `${name}::${stableKey(input)}`;
  const fixture = FIXTURE_RESPONSES[key];
  if (fixture) return fixture;
  return { success: true, bench_stub: true, note: 'No fixture or live endpoint configured', name, input };
}

async function executeDestructive({ name, input, env, dryRun }) {
  if (dryRun !== false) return mockDestructive(name, input);
  if (env?.STRATUS_BENCH_ALLOW_REAL_WRITES !== '1') return mockDestructive(name, input);
  if (!env?.GCHAT_URL || !env?.GCHAT_AUTH) return { success: false, error: 'real writes requested but gchat URL/auth not set' };
  const res = await fetch(`${env.GCHAT_URL}/api/bench-tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bench-auth': env.GCHAT_AUTH },
    body: JSON.stringify({ name, input, dry_run: false })
  });
  return await res.json();
}

function mockDestructive(name, input) {
  const mockId = String(Date.now());
  const baseUrl = 'https://crm.zoho.com/crm/org647122552';
  switch (name) {
    case 'create_deal_and_quote':
      return { success: true, records: { deal: { id: `DRY_DEAL_${mockId}`, url: `${baseUrl}/tab/Deals/DRY_DEAL_${mockId}` }, quote: { id: `DRY_QUOTE_${mockId}`, quote_number: `Q-DRY-${mockId}`, url: `${baseUrl}/tab/Quotes/DRY_QUOTE_${mockId}` } }, dry_run: true };
    case 'create_quote_on_deal':
      return { success: true, deal_id: input.deal_id, quote_id: `DRY_QUOTE_${mockId}`, dry_run: true };
    case 'quote_to_po_and_esign':
      return { success: true, workflow_result: true, quote_id: input.quote_id, po_id: `DRY_PO_${mockId}`, ccw_deal_number: '12345678', dry_run: true };
    case 'zoho_create_record':
      return { success: true, data: { details: { id: `DRY_${input.module_name}_${mockId}` } }, dry_run: true };
    case 'zoho_update_record':
      return { success: true, data: { details: { id: input.record_id } }, dry_run: true };
    case 'gmail_send_email':
      return { success: true, message_id: `DRY_MSG_${mockId}`, dry_run: true };
    default:
      return { success: true, name, input, dry_run: true };
  }
}

function isDestructive(name) {
  return ['zoho_create_record','zoho_update_record','zoho_delete_record','create_deal_and_quote','create_quote_on_deal','quote_to_po_and_esign','gmail_send_email','gmail_create_draft'].includes(name);
}

function stableKey(input) { return JSON.stringify(sortKeys(input || {})); }
function sortKeys(o) {
  if (Array.isArray(o)) return o.map(sortKeys);
  if (o && typeof o === 'object') return Object.keys(o).sort().reduce((acc, k) => { acc[k] = sortKeys(o[k]); return acc; }, {});
  return o;
}

export function loadFixtureResponses(fixtures) { for (const [k, v] of Object.entries(fixtures || {})) FIXTURE_RESPONSES[k] = v; }
