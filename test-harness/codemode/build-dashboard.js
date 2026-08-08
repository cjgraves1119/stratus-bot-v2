#!/usr/bin/env node
/** Reads results JSONL and emits side-by-side HTML comparison. */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) { console.error('Usage: build-dashboard.js <results.jsonl> [more.jsonl...]'); process.exit(1); }

const allRows = [];
for (const file of files) {
  for (const line of readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try { allRows.push({ ...JSON.parse(line), _source_file: file }); }
    catch (err) { console.error(`skip bad line in ${file}: ${err.message}`); }
  }
}

const byFixture = new Map();
for (const row of allRows) {
  if (!byFixture.has(row.fixture_id)) byFixture.set(row.fixture_id, []);
  byFixture.get(row.fixture_id).push(row);
}
const frameworkModelKeys = new Set();
for (const row of allRows) if (row.framework && row.model) frameworkModelKeys.add(`${row.framework}::${row.model}`);
const sortedKeys = [...frameworkModelKeys].sort();

const escapeHtml = s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function renderRollup(key, rows) {
  const n = rows.length; if (n === 0) return `<tr><td>${key}</td><td colspan="8">no rows</td></tr>`;
  const ok = rows.filter(r => r.success).length;
  const walls = rows.map(r => r.wall_ms || 0).filter(x => x > 0).sort((a, b) => a - b);
  const avgWall = walls.length ? Math.round(walls.reduce((s, w) => s + w, 0) / walls.length) : 0;
  const p95Wall = walls.length ? walls[Math.floor(walls.length * 0.95)] || walls[walls.length - 1] : 0;
  const avgIn = Math.round(rows.reduce((s, r) => s + (r.tokens_in || 0), 0) / n);
  const avgOut = Math.round(rows.reduce((s, r) => s + (r.tokens_out || 0), 0) / n);
  const avgIter = (rows.reduce((s, r) => s + (r.iterations || 0), 0) / n).toFixed(2);
  const toolLoops = rows.filter(r => r.framework_meta?.tool_loop_hit).length;
  return `<tr><td><strong>${key}</strong></td><td class="num">${n}</td><td class="num">${((ok / n) * 100).toFixed(1)}%</td><td class="num">${avgWall}</td><td class="num">${p95Wall}</td><td class="num">${avgIn}</td><td class="num">${avgOut}</td><td class="num">${avgIter}</td><td class="num">${toolLoops}</td></tr>`;
}

function renderFixtureRow(fixtureId, rows) {
  const sample = rows[0] || {};
  const rowByKey = new Map();
  for (const r of rows) rowByKey.set(`${r.framework}::${r.model}`, r);
  const cells = sortedKeys.map(k => {
    const r = rowByKey.get(k);
    if (!r) return '<td colspan="4" class="small">—</td>';
    const okCls = r.success ? 'ok' : 'fail';
    const okSym = r.success ? '✓' : '✗';
    const detail = r.errors?.length ? `<details><summary>${r.errors[0].phase || 'err'}</summary><pre>${escapeHtml(JSON.stringify(r.errors, null, 2))}</pre></details>` : '';
    const tcSummary = (r.tool_calls || []).map(tc => tc.name).join(' → ');
    return `<td class="${okCls}">${okSym}<div class="small">${escapeHtml(tcSummary)}</div>${detail}</td><td class="metric">${r.wall_ms ?? '—'}</td><td class="metric">${r.tokens_in ?? '—'}</td><td class="metric">${r.iterations ?? '—'}</td>`;
  }).join('');
  return `<tr><td><strong>${fixtureId}</strong><div class="small">${escapeHtml(sample.fixture_category || '')}</div></td><td><div class="small">${escapeHtml((sample.expected_tools || []).join(', '))}</div></td><td><div class="small">${escapeHtml(sample.user_message || '')}</div></td>${cells}</tr>`;
}

function renderSummaryCards() {
  return sortedKeys.map(key => {
    const subset = allRows.filter(r => `${r.framework}::${r.model}` === key);
    if (subset.length === 0) return '';
    const ok = subset.filter(r => r.success).length;
    const avgIn = Math.round(subset.reduce((s, r) => s + (r.tokens_in || 0), 0) / subset.length);
    return `<div class="summary-card"><h3>${escapeHtml(key)}</h3><div class="big">${((ok / subset.length) * 100).toFixed(0)}%</div><div class="sub">${ok}/${subset.length} success • avg ${avgIn} tokens in</div></div>`;
  }).join('');
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stratus Code Mode A/B</title><style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 24px; color: #222; }
h1 { margin-bottom: 4px; } .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; font-weight: 600; position: sticky; top: 0; }
td.ok { background: #e6ffed; } td.fail { background: #ffeef0; }
td.metric, .num { font-variant-numeric: tabular-nums; text-align: right; }
.small { font-size: 11px; color: #666; }
details summary { cursor: pointer; color: #0969da; font-size: 11px; }
details pre { background: #f6f8fa; padding: 8px; border-radius: 4px; overflow-x: auto; max-height: 200px; }
.summary-bar { display: flex; gap: 24px; padding: 16px; background: #f6f8fa; border-radius: 8px; margin-bottom: 24px; flex-wrap: wrap; }
.summary-card { padding: 12px 16px; background: white; border-radius: 6px; min-width: 200px; }
.summary-card h3 { margin: 0 0 8px 0; font-size: 13px; color: #666; font-weight: 500; }
.summary-card .big { font-size: 28px; font-weight: 600; line-height: 1; }
.summary-card .sub { font-size: 12px; color: #666; margin-top: 4px; }
</style></head><body>
<h1>Stratus Code Mode A/B — bench dashboard</h1>
<div class="meta">Generated ${new Date().toISOString()} • Sources: ${files.join(', ')} • Total rows: ${allRows.length}</div>
<div class="summary-bar">${renderSummaryCards()}</div>
<h2>Per-fixture breakdown</h2>
<table><thead><tr><th rowspan="2">Fixture</th><th rowspan="2">Expected</th><th rowspan="2">User message</th>
${sortedKeys.map(k => `<th colspan="4">${k}</th>`).join('')}
</tr><tr>${sortedKeys.map(() => '<th>ok</th><th>wall</th><th>in</th><th>iter</th>').join('')}</tr></thead>
<tbody>${[...byFixture.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fid, rows]) => renderFixtureRow(fid, rows)).join('\n')}</tbody></table>
<h2>Per-framework rollup</h2>
<table><thead><tr><th>Framework × Model</th><th>n</th><th>ok %</th><th>avg ms</th><th>p95 ms</th><th>avg in</th><th>avg out</th><th>avg iter</th><th>loop hits</th></tr></thead>
<tbody>${sortedKeys.map(k => renderRollup(k, allRows.filter(r => `${r.framework}::${r.model}` === k))).join('\n')}</tbody></table>
</body></html>`;

console.log(html);
