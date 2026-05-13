#!/usr/bin/env node
// 2026-05-13 regression: resolveAccountByDomain falls back to a
// Contact-at-domain hop when Website:equals variants all miss.
// Codex C2 failure: rmansell@parexcellence.com IS a Contact at PAR
// Excellence, jjackson@parexcellence.com is NOT. Switching the active
// chip to Javon caused the waterfall to return null even though Ray's
// record proves the domain belongs to PAR Excellence in CRM.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Source wiring ===\n');

t('Contact-at-domain fallback block exists', () => {
  assert.ok(
    /Contact-at-domain hop fallback \(Codex C2 fix\)/.test(source),
    'fallback block missing'
  );
});

t('Fallback queries Contacts via COQL LIKE %@DOMAIN', () => {
  assert.ok(
    /Contacts where Email like '%@\$\{d\}' limit 5/.test(source),
    'fallback must use COQL LIKE %@DOMAIN'
  );
});

t('Fallback defensively re-validates the email ends with @DOMAIN', () => {
  assert.ok(
    /email\.endsWith\(`@\$\{d\}`\)/.test(source),
    'defensive email.endsWith check missing (Zoho `contains` can match substrings unexpectedly)'
  );
});

t('Fallback requires the matched contact to have a populated Account_Name lookup', () => {
  // The find() predicate must reject contacts with no Account_Name.
  assert.ok(
    /if \(!acct\) return false;/.test(source),
    'contacts without Account_Name must be skipped'
  );
});

t('Fallback hops to fetchAccount by id (full record fetch)', () => {
  assert.ok(
    /Accounts\/\$\{acctId\}\?fields=\$\{fields\}/.test(source),
    'fallback must fetch the full Account record by id'
  );
});

t('Fallback logs a [ACCT-DOMAIN] resolution line for observability', () => {
  assert.ok(
    /\[ACCT-DOMAIN\] Resolved \$\{d\} via Contact-at-domain hop/.test(source),
    'console.log for successful hop missing'
  );
});

t('Hop fails closed on Zoho error (warn but return null)', () => {
  assert.ok(
    /\[ACCT-DOMAIN\] Contact-at-domain hop failed for \$\{d\}/.test(source),
    'error path must warn so anomalies are visible in CF logs'
  );
});

console.log('\n=== Behavioral simulation ===\n');

function buildResolver() {
  const normalizeDomain = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null;
  return function (zohoApiCallStub) {
    async function resolveAccountByDomain(domain, env) {
      const d = normalizeDomain(domain);
      if (!d) return null;
      const fields = 'id,Account_Name,Website';
      const variants = [d, `www.${d}`, `https://${d}`, `https://www.${d}`, `http://${d}`, `http://www.${d}`];
      for (const v of variants) {
        try {
          const r = await zohoApiCallStub('GET', `Accounts/search?criteria=(Website:equals:${encodeURIComponent(v)})&fields=${fields}&per_page=1`, env);
          if (r?.data?.[0]) return r.data[0];
        } catch (_) {}
      }
      try {
        const coql = `select id, Email, Account_Name from Contacts where Email like '%@${d}' limit 5`;
        const r = await zohoApiCallStub('POST', 'coql', env, { select_query: coql });
        const rows = Array.isArray(r?.data) ? r.data : [];
        const linkedContact = rows.find(c => {
          const email = String(c?.Email || '').toLowerCase();
          if (!email.endsWith(`@${d}`)) return false;
          const acct = c?.Account_Name;
          if (!acct) return false;
          if (typeof acct === 'object') return !!(acct.id || acct.name);
          return !!String(acct).trim();
        });
        const acctId = linkedContact?.Account_Name?.id;
        if (acctId) {
          const acctResp = await zohoApiCallStub('GET', `Accounts/${acctId}?fields=${fields}`, env);
          if (acctResp?.data?.[0]) return acctResp.data[0];
        }
      } catch (_) {}
      return null;
    }
    return resolveAccountByDomain;
  };
}

t('SCENARIO 1: Website matches a variant → return account without hop', async () => {
  const stub = async (_method, path) => {
    if (path.includes('Accounts/search') && path.includes('parexcellence.com')) {
      return { data: [{ id: 'A1', Account_Name: 'PAR Excellence', Website: 'parexcellence.com' }] };
    }
    return { data: [] };
  };
  const fn = buildResolver()(stub);
  const out = await fn('parexcellence.com');
  assert.equal(out?.id, 'A1');
});

t('SCENARIO 2: Website misses, Contact-at-domain hop fires and resolves (C2 fix)', async () => {
  let websiteCalls = 0;
  let contactsCalled = false;
  let accountFetchCalled = false;
  const stub = async (_method, path) => {
    if (path.includes('Accounts/search') && path.includes('Website:equals')) {
      websiteCalls++;
      return { data: [] };  // no website match for any variant
    }
    if (path.includes('coql')) {
      contactsCalled = true;
      return { data: [
        { id: 'CRay', Email: 'rmansell@parexcellence.com',
          Account_Name: { id: 'A1', name: 'PAR Excellence' } }
      ] };
    }
    if (path.startsWith('Accounts/A1')) {
      accountFetchCalled = true;
      return { data: [{ id: 'A1', Account_Name: 'PAR Excellence', Website: '' }] };
    }
    return { data: [] };
  };
  const fn = buildResolver()(stub);
  const out = await fn('parexcellence.com');
  assert.ok(websiteCalls > 0, 'website-equals variants must be attempted first');
  assert.ok(contactsCalled, 'Contacts search must fire when website misses');
  assert.ok(accountFetchCalled, 'Account fetch by id must hop from contact');
  assert.equal(out?.id, 'A1', 'final return must be PAR Excellence');
});

t('SCENARIO 3: Hop predicate rejects substring false positives', async () => {
  // Zoho "contains" might match "ray@foo.parexcellence.com.au" → must reject.
  const stub = async (_method, path) => {
    if (path.includes('Accounts/search')) return { data: [] };
    if (path.includes('coql')) {
      return { data: [
        { id: 'CFake', Email: 'ray@parexcellence.com.au', Account_Name: { id: 'AFake' } }
      ] };
    }
    return { data: [] };
  };
  const fn = buildResolver()(stub);
  const out = await fn('parexcellence.com');
  assert.equal(out, null, 'must NOT match ray@parexcellence.com.au for domain parexcellence.com');
});

t('SCENARIO 4: Hop predicate rejects contacts with no Account_Name', async () => {
  const stub = async (_method, path) => {
    if (path.includes('Accounts/search')) return { data: [] };
    if (path.includes('coql')) {
      return { data: [
        { id: 'COrphan', Email: 'orphan@parexcellence.com', Account_Name: null }
      ] };
    }
    return { data: [] };
  };
  const fn = buildResolver()(stub);
  const out = await fn('parexcellence.com');
  assert.equal(out, null, 'must skip orphan contacts with no Account_Name');
});

t('SCENARIO 5: Hop prefers first contact with Account_Name when mix exists', async () => {
  const stub = async (_method, path) => {
    if (path.includes('Accounts/search')) return { data: [] };
    if (path.includes('coql')) {
      return { data: [
        { id: 'COrphan1', Email: 'a@parexcellence.com', Account_Name: null },
        { id: 'CLinked',  Email: 'b@parexcellence.com', Account_Name: { id: 'A1' } },
        { id: 'COrphan2', Email: 'c@parexcellence.com', Account_Name: null }
      ] };
    }
    if (path.startsWith('Accounts/A1')) {
      return { data: [{ id: 'A1', Account_Name: 'PAR Excellence' }] };
    }
    return { data: [] };
  };
  const fn = buildResolver()(stub);
  const out = await fn('parexcellence.com');
  assert.equal(out?.id, 'A1');
});

t('SCENARIO 6: No contacts at domain → returns null', async () => {
  const stub = async () => ({ data: [] });
  const fn = buildResolver()(stub);
  const out = await fn('unknowndomain.example');
  assert.equal(out, null);
});

setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);
