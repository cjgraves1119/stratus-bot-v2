/**
 * Local test for TD Synnex pricing worker
 * Tests the API connection and validates response parsing
 *
 * Usage: node test-local.js
 */

const AUTH_TOKEN = process.env.TDSYNNEX_AUTH_TOKEN;
if (!AUTH_TOKEN) { console.error('Set TDSYNNEX_AUTH_TOKEN env var (Basic <base64>) before running.'); process.exit(1); }
const API_BASE = 'https://ws.us.tdsynnex.com/webservice/ltd/api';

// Test SKUs across product families
const TEST_SKUS = [
  // APs
  'MR46E-HW',
  'CW9164I-MR',
  // Switches
  'MS130-8',
  'C9300-48P-M',
  // Security
  'MX68-HW',
  'MX105-HW',
  // Cameras
  'MV12W-HW',
  'MV63X-HW',
  // Sensors
  'MT15-HW',
  // License (should return nothing)
  'LIC-ENT-3Y',
  // Accessories
  'MA-MNT-MR-11',
];

async function testSku(sku) {
  const url = `${API_BASE}/products?qualifier=MG&partNumbers=${encodeURIComponent(sku)}`;
  try {
    const resp = await fetch(url, {
      headers: { 'Authorization': AUTH_TOKEN, 'Accept': 'application/json' },
    });
    const data = await resp.json();

    if (data.Message) {
      return { sku, status: 'NOT_FOUND', message: data.Message };
    }

    if (Array.isArray(data) && data.length > 0) {
      // Pick Cisco result with pricing
      const best = data.find(r =>
        r.ManufacturerName?.includes('CISCO') &&
        r.CustomerCanSeePricing !== false &&
        r.BestPrice
      ) || data.find(r => r.BestPrice) || data[0];

      return {
        sku,
        status: 'FOUND',
        best_price: best.BestPrice,
        msrp: best.MSRP,
        unit_cost: best.UnitCost,
        has_promo: best.HasPromotion,
        description: best.Description?.substring(0, 60),
        results_count: data.length,
      };
    }

    return { sku, status: 'EMPTY', data };
  } catch (err) {
    return { sku, status: 'ERROR', error: err.message };
  }
}

async function main() {
  console.log('=== TD Synnex API Test ===\n');

  let found = 0, notFound = 0, errors = 0;

  for (const sku of TEST_SKUS) {
    const result = await testSku(sku);

    if (result.status === 'FOUND') {
      found++;
      console.log(`  ✅ ${sku.padEnd(20)} | Best: $${result.best_price?.padStart(10) || 'N/A'.padStart(10)} | MSRP: $${result.msrp?.padStart(10) || 'N/A'.padStart(10)} | Promo: ${result.has_promo ? 'YES' : 'no'} | ${result.description}`);
    } else if (result.status === 'NOT_FOUND') {
      notFound++;
      console.log(`  ❌ ${sku.padEnd(20)} | Not in TD Synnex catalog`);
    } else {
      errors++;
      console.log(`  ⚠️  ${sku.padEnd(20)} | ${result.status}: ${result.error || JSON.stringify(result.data)}`);
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Found:     ${found}/${TEST_SKUS.length}`);
  console.log(`  Not Found: ${notFound}/${TEST_SKUS.length}`);
  console.log(`  Errors:    ${errors}/${TEST_SKUS.length}`);
  console.log(`\nNote: License SKUs and older/EOL hardware are expected to be "Not Found".`);
}

main().catch(console.error);
