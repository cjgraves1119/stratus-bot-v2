/**
 * Canonical tool surface for the bench.
 * Splits into READ_TOOLS (eligible for Code Mode sandbox) and WRITE_TOOLS
 * (must stay on standard tool-calling — Cloudflare codemode does not yet
 * support needsApproval workflows).
 */

const READ_TOOLS = [
  {
    name: 'zoho_search_records',
    description: 'Search Zoho CRM records in any module via COQL criteria.',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string' },
        criteria: { type: 'string' },
        fields: { type: 'string' },
        per_page: { type: 'integer' }
      },
      required: ['module_name', 'criteria']
    }
  },
  {
    name: 'zoho_get_record',
    description: 'Fetch a single Zoho CRM record by id.',
    input_schema: {
      type: 'object',
      properties: { module_name: { type: 'string' }, record_id: { type: 'string' }, fields: { type: 'string' } },
      required: ['module_name', 'record_id']
    }
  },
  {
    name: 'zoho_get_related_records',
    description: 'Fetch records related to a parent (e.g. Sales_Orders for a Deal).',
    input_schema: {
      type: 'object',
      properties: { module_name: { type: 'string' }, record_id: { type: 'string' }, related_module: { type: 'string' } },
      required: ['module_name', 'record_id', 'related_module']
    }
  },
  {
    name: 'batch_product_lookup',
    description: 'Resolve product_id + cached pricing for SKUs from prices.json.',
    input_schema: { type: 'object', properties: { skus: { type: 'array', items: { type: 'string' } } }, required: ['skus'] }
  },
  {
    name: 'parse_quote_url',
    description: 'Parse a Stratus quote URL into ordered line items with pricing.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'web_search_domain',
    description: 'Look up a company by its email domain.',
    input_schema: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] }
  },
  {
    name: 'gmail_search_messages',
    description: 'Search Gmail messages.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] }
  },
  {
    name: 'gmail_read_message',
    description: 'Read a Gmail message body.',
    input_schema: { type: 'object', properties: { message_id: { type: 'string' } }, required: ['message_id'] }
  },
  {
    name: 'gmail_read_thread',
    description: 'Read all messages in a Gmail thread.',
    input_schema: { type: 'object', properties: { thread_id: { type: 'string' } }, required: ['thread_id'] }
  },
  {
    name: 'lookup_cisco_rep',
    description: 'Find a Cisco rep (Meraki ISR) by email.',
    input_schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }
  }
];

const WRITE_TOOLS = [
  { name: 'zoho_create_record', description: 'Create a Zoho CRM record. Validates payload server-side.', input_schema: { type: 'object', properties: { module_name: { type: 'string' }, data: { type: 'object' } }, required: ['module_name', 'data'] } },
  { name: 'zoho_update_record', description: 'Update a Zoho CRM record by id.', input_schema: { type: 'object', properties: { module_name: { type: 'string' }, record_id: { type: 'string' }, data: { type: 'object' } }, required: ['module_name', 'record_id', 'data'] } },
  { name: 'create_deal_and_quote', description: 'Compound: Account, Contact, Deal, Quote, Task in one shot.', input_schema: { type: 'object', properties: { account_name: { type: 'string' }, contact_name: { type: 'string' }, contact_email: { type: 'string' }, skus: { type: 'array', items: { type: 'object' } }, license_term: { type: 'string' }, billing_address: { type: 'object' }, include_licenses: { type: 'boolean' }, hardware_only: { type: 'boolean' } }, required: ['account_name', 'skus'] } },
  { name: 'create_quote_on_deal', description: 'Compound: create Quote on existing Deal (no duplicate Deal).', input_schema: { type: 'object', properties: { deal_id: { type: 'string' }, skus: { type: 'array' }, hardware_only: { type: 'boolean' } }, required: ['deal_id', 'skus'] } },
  { name: 'quote_to_po_and_esign', description: 'Compound: DID, Velocity Hub, ConvertQuoteToSO, vendor preflight, SendToEsign.', input_schema: { type: 'object', properties: { quote_id: { type: 'string' }, send_for_esign: { type: 'boolean' }, force_create_po: { type: 'boolean' }, sales_order_id: { type: 'string' } }, required: ['quote_id'] } },
  { name: 'gmail_send_email', description: 'Send a Gmail email.', input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } }
];

function getToolsForToolsRunner() { return [...READ_TOOLS, ...WRITE_TOOLS]; }
function getToolsForCodemodeRunner() { return { codemodeWrappedReadTools: READ_TOOLS, standardWriteTools: WRITE_TOOLS }; }

export { READ_TOOLS, WRITE_TOOLS, getToolsForToolsRunner, getToolsForCodemodeRunner };
