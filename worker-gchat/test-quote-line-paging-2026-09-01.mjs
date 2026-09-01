/**
 * Regression for the 18-line Quote failure reported 2026-09-01.
 *
 * The old CRM loop cut Quote tool results at 8,000 characters, producing
 * invalid JSON around line 16. These tests run the shipped Quote read and
 * transport formatter and prove later rows stay addressable and parseable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(WORKER, 'x.cjs'));
const SOURCE = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = SOURCE;
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) {
    let d = 0, started = false, end = i;
    for (let k = i; k < src.length; k++) {
      if (src[k] === '{') { d++; started = true; }
      if (src[k] === '}') { d--; if (started && d === 0) { end = k + 1; break; } }
    }
    src = src.slice(0, i) + src.slice(end + 1);
  }
  src += '\nmodule.exports={executeToolCall,formatToolResultForModel,setZohoApiCall:(fn)=>{zohoApiCall=fn;}};\n';
  const tmp = path.join(WORKER, `.tmp-quote-paging-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  try { delete require.cache[require.resolve(tmp)]; return require(tmp); } finally { fs.unlinkSync(tmp); }
}

const worker = extractWorker();
const QUOTE_ID = '2570562000424802189';

function quoteItems(descriptionLength = 120) {
  return Array.from({ length: 18 }, (_, index) => {
    const line = index + 1;
    return {
      id: `line-${line}`,
      Product_Name: { id: `product-${line}`, name: `Product ${line}`, Product_Code: `SKU-${line}` },
      Sequence_Number: line,
      Description: `Line ${line} ${'description '.repeat(descriptionLength)}`,
      Quantity: 2,
      List_Price: 1000 + line,
      unit_price: 1000 + line,
      Discount: 100,
      Total: 2000 + line,
      Tax: 0,
      Net_Total: 1900 + line,
    };
  });
}

function stubQuote(items) {
  worker.setZohoApiCall(async (method, apiPath) => {
    assert.equal(method, 'GET');
    assert.equal(apiPath, `Quotes/${QUOTE_ID}`);
    return { data: [{ id: QUOTE_ID, Subject: '18-line regression', Quoted_Items: items }] };
  });
}

test('default Quote read returns all 18 lines and exposes truthful page metadata', async () => {
  stubQuote(quoteItems(2));
  const result = JSON.parse(await worker.executeToolCall('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID,
  }, {}, null));
  const quote = result.data[0];
  assert.equal(quote._line_item_count, 18);
  assert.equal(quote._line_items_returned, 18);
  assert.equal(quote._line_items_has_more, false);
  assert.equal(quote.Quoted_Items.at(-1).id, 'line-18');
  assert.match(quote.Quoted_Items.at(-1).Description, /^Line 18 /);
});

test('a targeted read can retrieve lines 17 and 18 directly', async () => {
  stubQuote(quoteItems(2));
  const result = JSON.parse(await worker.executeToolCall('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID, line_item_start: 17, line_item_limit: 2,
  }, {}, null));
  const quote = result.data[0];
  assert.deepEqual(quote.Quoted_Items.map((row) => row.id), ['line-17', 'line-18']);
  assert.equal(quote._line_item_start, 17);
  assert.equal(quote._line_item_end, 18);
  assert.equal(quote._line_items_has_more, false);
});

test('an exact line-18 read returns only line 18', async () => {
  stubQuote(quoteItems(2));
  const result = JSON.parse(await worker.executeToolCall('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID, line_item_start: 18, line_item_limit: 1,
  }, {}, null));
  const quote = result.data[0];
  assert.deepEqual(quote.Quoted_Items.map((row) => row.id), ['line-18']);
  assert.equal(quote._line_item_start, 18);
  assert.equal(quote._line_item_end, 18);
});

test('Quote search auto-expand returns a truthful first page for quotes over 25 lines', async () => {
  const items = [...quoteItems(2), ...quoteItems(2).slice(0, 12).map((row, index) => ({
    ...row,
    id: `line-${index + 19}`,
    Sequence_Number: index + 19,
    Description: `Line ${index + 19}`,
  }))];
  worker.setZohoApiCall(async (method, apiPath) => {
    assert.equal(method, 'GET');
    if (apiPath.startsWith('Quotes/search?')) return { data: [{ id: QUOTE_ID, Subject: '30-line search result' }] };
    if (apiPath === `Quotes/${QUOTE_ID}`) return { data: [{ id: QUOTE_ID, Subject: '30-line search result', Quoted_Items: items }] };
    throw new Error(`unexpected path: ${apiPath}`);
  });
  const result = JSON.parse(await worker.executeToolCall('zoho_search_records', {
    module_name: 'Quotes', criteria: '(Subject:equals:30-line search result)',
  }, {}, null));
  const quote = result.data[0];
  assert.equal(quote._line_item_count, 30);
  assert.equal(quote._line_items_returned, 25);
  assert.equal(quote._line_items_has_more, true);
  assert.equal(quote._line_items_next_start, 26);
  assert.equal(quote.Quoted_Items.at(-1).id, 'line-25');
});

test('page 2 can retrieve lines 26 through 30 after a 25-line first page', async () => {
  const items = Array.from({ length: 30 }, (_, index) => ({
    id: `line-${index + 1}`,
    Product_Name: { id: `product-${index + 1}`, name: `Product ${index + 1}`, Product_Code: `SKU-${index + 1}` },
    Sequence_Number: index + 1,
    Description: `Line ${index + 1}`,
    Quantity: 1,
    List_Price: 100,
    Discount: 0,
    Net_Total: 100,
  }));
  stubQuote(items);
  const result = JSON.parse(await worker.executeToolCall('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID, line_item_start: 26, line_item_limit: 25,
  }, {}, null));
  const quote = result.data[0];
  assert.deepEqual(quote.Quoted_Items.map((row) => row.id), ['line-26', 'line-27', 'line-28', 'line-29', 'line-30']);
  assert.equal(quote._line_items_has_more, false);
});

test('oversized Quote transport stays valid JSON and returns a continuation cursor', async () => {
  stubQuote(quoteItems(220));
  const raw = await worker.executeToolCall('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID,
  }, {}, null);
  assert.ok(raw.length > 32000, 'fixture must reproduce the former truncation class');

  const formatted = worker.formatToolResultForModel('zoho_get_record', {
    module_name: 'Quotes', record_id: QUOTE_ID,
  }, raw);
  assert.doesNotMatch(formatted, /\.\.\.\(truncated\)$/);
  assert.ok(formatted.length <= 32000, `formatted result exceeded budget: ${formatted.length}`);
  const quote = JSON.parse(formatted).data[0];
  assert.ok(quote._line_items_returned > 0);
  assert.ok(quote._line_items_returned < 18);
  assert.equal(quote._line_items_has_more, true);
  assert.equal(quote._line_items_next_start, quote._line_item_end + 1);
  assert.equal(quote.Quoted_Items.at(-1).id, `line-${quote._line_item_end}`);
});

test('oversized Quote search fallback without Quoted_Items remains valid JSON', () => {
  const raw = JSON.stringify({
    data: Array.from({ length: 100 }, (_, index) => ({
      id: `quote-${index + 1}`,
      Subject: `Quote ${index + 1} ${'large subject '.repeat(35)}`,
      Quote_Number: `Q-${index + 1}`,
    })),
    info: { page: 1, more_records: true },
  });
  assert.ok(raw.length > 32000);
  const formatted = worker.formatToolResultForModel('zoho_search_records', {
    module_name: 'Quotes', criteria: '(Subject:contains:Quote)',
  }, raw);
  assert.ok(formatted.length <= 32000);
  assert.doesNotMatch(formatted, /\.\.\.\(truncated\)$/);
  const parsed = JSON.parse(formatted);
  assert.ok(parsed.data.length > 0 && parsed.data.length < 100);
  assert.equal(parsed._transport_records_has_more, true);
  assert.equal(parsed._transport_next_page, 2);
});

test('source guard: ranged same-batch Quote gets are never replaced by search page 1', () => {
  assert.match(SOURCE, /if \(!isRangedQuoteRead && _quotesSearchDone\)/);
  assert.match(SOURCE, /if \(!isRangedQuoteRead && _expandedQuoteCache\[block\.input\?\.record_id\]\)/);
});
