// Test the buildStratusUrl function

function buildStratusUrl(items) {
  // Consolidate duplicate SKUs by summing quantities
  const merged = new Map();
  for (const { sku, qty } of items) {
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  const skus = [...merged.keys()];
  const qtys = skus.map(s => merged.get(s));
  console.log('Items:', items);
  console.log('Merged Map:', Array.from(merged.entries()));
  console.log('SKUs:', skus);
  console.log('QTYs:', qtys);
  const url = `https://stratusinfosystems.com/order/?item=${skus.join(',')}&qty=${qtys.join(',')}`;
  console.log('URL:', url);
  return url;
}

// Test with the problematic option 1 items
const testItems = [
  { sku: 'LIC-ENT-1YR', qty: 349 },  // MR APs: 7+1+340+1
  { sku: 'LIC-MS120-24P-1YR', qty: 11 },
  { sku: 'LIC-MS120-48FP-1YR', qty: 8 },
  { sku: 'LIC-MS120-48LP-1YR', qty: 1 },
  { sku: 'MR36-HW', qty: 7 },
  { sku: 'MR44-HW', qty: 340 },
  { sku: 'MR76-HW', qty: 1 },
  { sku: 'MS130-24P-HW', qty: 3 },
  { sku: 'MS130-48P-HW', qty: 5 },
  { sku: 'MS130-8P-HW', qty: 1 },
  { sku: 'MX85-HW', qty: 13 },
  { sku: 'LIC-MX85-SEC-1Y', qty: 13 }
];

console.log('\n=== OPTION 1 TEST ===');
buildStratusUrl(testItems);
