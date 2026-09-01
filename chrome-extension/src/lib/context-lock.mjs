const GMAIL_PREFIX = 'https://mail.google.com/';
const ZOHO_HOST = 'crm.zoho.com';

export const CHAT_SESSION_STORAGE_KEY = 'stratusActiveChatSessionV1';
export const MAX_LOCKED_EMAIL_BODY_CHARS = 8000;
export const MAX_LOCKED_MESSAGES = 80;
export const MAX_STORED_MESSAGE_CHARS = 12000;
export const MAX_STORED_QUOTE_URLS = 10;
export const MAX_STORED_QUOTE_ITEMS = 100;
export const MAX_STORED_ONESHOT_TOKEN_CHARS = 12000;

const ORDER_URL_HOSTS = new Set(['stratusinfosystems.com', 'www.stratusinfosystems.com']);
const ORDER_URL_PATH = '/order/';

function safeString(value, max = 500) {
  return String(value == null ? '' : value).slice(0, max);
}

function containsMargin(value) {
  return /\bmargin\b|margin\s*%|gross\s*profit/i.test(String(value || ''));
}

function safeCustomerVisibleString(value, max) {
  const text = safeString(value, max).trim();
  return text && !containsMargin(text) ? text : '';
}

function sanitizeStoredOrderUrl(value) {
  const raw = safeString(value, 4000).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !ORDER_URL_HOSTS.has(url.hostname) || url.pathname !== ORDER_URL_PATH) return null;
    if (url.username || url.password || containsMargin(url.toString())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeStoredQuoteMessage(message) {
  const rawUrls = Array.isArray(message?.result?.urls) ? message.result.urls : [];
  const urls = rawUrls.map((option, index) => {
    const source = option && typeof option === 'object' ? option : { url: option };
    const url = sanitizeStoredOrderUrl(source.url);
    if (!url) return null;
    const stored = {
      url,
      label: safeCustomerVisibleString(source.label, 160) || `Option ${index + 1}`,
    };
    if (source.hardwareOnly === true) stored.hardwareOnly = true;
    const termYears = Number(source.termYears);
    if (Number.isInteger(termYears) && termYears >= 1 && termYears <= 5) stored.termYears = termYears;
    const optionKind = safeCustomerVisibleString(source.optionKind, 40);
    const optionGroupId = safeCustomerVisibleString(source.optionGroupId, 100);
    if (optionKind) stored.optionKind = optionKind;
    if (optionGroupId) stored.optionGroupId = optionGroupId;
    return stored;
  }).filter(Boolean).slice(0, MAX_STORED_QUOTE_URLS);
  if (urls.length === 0) return null;

  const parsed = (Array.isArray(message?.result?.parsed) ? message.result.parsed : [])
    .map((item) => {
      const baseSku = safeCustomerVisibleString(item?.baseSku || item?.sku, 160);
      const qty = Number(item?.qty);
      if (!baseSku || !Number.isFinite(qty) || qty <= 0 || qty > 500) return null;
      const resolvedSku = safeCustomerVisibleString(item?.resolvedSku, 160).trim().toUpperCase();
      const safeResolvedSku = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(resolvedSku)
        ? resolvedSku
        : '';
      const requestedTier = safeCustomerVisibleString(item?.requestedTier || item?.tier, 40)
        .toUpperCase().replace(/[\s_-]+/g, '');
      const effectiveSku = safeResolvedSku || baseSku.trim().toUpperCase();
      const hardwareOnly = item?.hardwareOnly === true
        && item?.licenseOnly !== true
        && !effectiveSku.startsWith('LIC-');
      const licenseOnly = item?.licenseOnly === true
        && item?.hardwareOnly !== true
        && effectiveSku.startsWith('LIC-');
      return {
        baseSku,
        qty: Math.floor(qty),
        ...(safeResolvedSku ? { resolvedSku: safeResolvedSku } : {}),
        ...(hardwareOnly ? { hardwareOnly: true } : {}),
        ...(licenseOnly ? { licenseOnly: true } : {}),
        ...(['ENT', 'ENTERPRISE', 'SEC', 'SECURITY', 'ADVANCEDSECURITY', 'SDW', 'SDWAN', 'SDWANPLUS', 'A', 'ADVANCED', 'E', 'ESSENTIALS'].includes(requestedTier)
          ? { requestedTier }
          : {}),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_STORED_QUOTE_ITEMS);

  const eolWarnings = (Array.isArray(message?.result?.eolWarnings) ? message.result.eolWarnings : [])
    .map((warning) => safeCustomerVisibleString(
      typeof warning === 'string' ? warning : `${warning?.sku || ''} is End-of-Life`,
      500,
    ))
    .filter(Boolean)
    .slice(0, 30);

  const eolMapping = (Array.isArray(message?.eolMapping) ? message.eolMapping : [])
    .map((line) => safeCustomerVisibleString(line, 500))
    .filter(Boolean)
    .slice(0, 30);

  const quoteHaRequested = message?.quoteHaRequested === true
    || message?.intake?.intent?.ha_requested === true
    || message?.emailQuoteContext?.intent?.ha_requested === true;
  const rawTier = safeString(
    message?.quoteLicenseTier
      || message?.intake?.intent?.license_tier
      || message?.emailQuoteContext?.intent?.license_tier,
    10,
  ).trim().toUpperCase();
  const quoteLicenseTier = ['ENT', 'SEC', 'SDW', 'A'].includes(rawTier) ? rawTier : null;
  const quoteSupportsHardwareOnly = urls.some((option) => option.hardwareOnly === true);
  const quoteHardwareOnly = message?.quoteHardwareOnly === true
    || message?.intake?.intent?.hardware_only === true
    || message?.emailQuoteContext?.intent?.hardware_only === true;

  return {
    kind: 'quote',
    restored: true,
    skuText: safeCustomerVisibleString(message.skuText, 8000),
    note: safeCustomerVisibleString(message.note, 2000),
    quoteHaRequested,
    quoteLicenseTier,
    quoteSupportsHardwareOnly,
    quoteHardwareOnly,
    eolMapping,
    result: {
      urls,
      parsed,
      eolWarnings,
      suggestions: null,
      source: 'restored-session',
    },
  };
}

function cleanSkuLines(values) {
  if (!Array.isArray(values)) return [];
  return values.map((item) => {
    const sku = safeString(item?.sku || item?.baseSku, 160).trim().toUpperCase();
    const qty = Number(item?.qty);
    if (!/^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(sku) || !Number.isInteger(qty) || qty < 1 || qty > 99999) return null;
    return { sku, qty };
  }).filter(Boolean).slice(0, MAX_STORED_QUOTE_ITEMS);
}

// One-shot persistence is an explicit shape whitelist. Server responses may
// grow new free-text fields over time, and Gmail intake lines can contain a raw
// `evidence` excerpt. Persist only values the review UI or exact Execute retry
// actually needs; unknown fields never enter extension storage.
const ACCOUNT_REVIEW_FIELDS = ['name', 'street', 'city', 'state', 'zip', 'country', 'website'];
const ONESHOT_BLOCKER_CODES = new Set([
  'ambiguous_contact', 'missing_contact', 'contact_not_eligible',
  'account_not_readable', 'account_confirm', 'account_billing_incomplete', 'account_create_review',
  'contact_account_mismatch', 'contact_linked_elsewhere', 'contact_name_required',
  'deal_choice', 'isr_inactive', 'isr_ambiguous', 'isr_not_found', 'isr_required_for_lead_source',
  'missing_skus', 'invalid_sku_quantity', 'unresolved_sku', 'inactive_sku', 'eol_sku', 'product_lookup_failed',
  'ha_mode_invalid', 'ha_requires_shared_license', 'ha_hardware_required', 'ha_mixed_hardware',
  'ha_hardware_unsupported', 'ha_even_hardware_quantity_required', 'ha_ambiguous_license_lines',
  'ha_license_term_conflict', 'ha_shared_license_unresolved', 'ha_license_family_conflict',
  'ha_license_quantity_conflict', 'ha_recalculate_requires_warm_spare',
]);

function pickScalars(source, { text = [], numbers = [], booleans = [] } = {}) {
  const input = source && typeof source === 'object' ? source : {};
  const out = {};
  for (const entry of text) {
    const [key, max = 500] = Array.isArray(entry) ? entry : [entry, 500];
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] != null) out[key] = safeString(input[key], max);
  }
  for (const key of numbers) {
    if (Number.isFinite(input[key])) out[key] = Number(input[key]);
  }
  for (const key of booleans) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }
  return out;
}

function sanitizeOneshotPerson(value) {
  if (!value || typeof value !== 'object') return null;
  const person = pickScalars(value, {
    text: [['id', 160], ['name', 300], ['email', 320], ['role', 80], ['status', 80], ['stage', 160], ['closing_date', 40]],
    numbers: ['amount'],
    booleans: ['inactive', 'vendor'],
  });
  return Object.keys(person).length ? person : null;
}

function sanitizeAccountValues(value) {
  return pickScalars(value, { text: ACCOUNT_REVIEW_FIELDS.map((field) => [field, field === 'website' ? 1000 : 500]) });
}

function sanitizeFieldProvenance(value) {
  const source = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const field of ACCOUNT_REVIEW_FIELDS) {
    const row = pickScalars(source[field], {
      text: [['source', 160], ['value', 1000], ['tier', 160], ['confidence', 80]],
      booleans: ['refreshed'],
    });
    if (Object.keys(row).length) out[field] = row;
  }
  return out;
}

function sanitizeEnrichmentComparison(value) {
  if (!value || typeof value !== 'object') return null;
  const out = { mode: value.mode === 'compare' ? 'compare' : 'compare' };
  out.current = sanitizeAccountValues(value.current);
  out.candidate = sanitizeAccountValues(value.candidate);
  out.differences = (Array.isArray(value.differences) ? value.differences : []).map((row) => {
    const field = safeString(row?.field, 40);
    if (!ACCOUNT_REVIEW_FIELDS.includes(field)) return null;
    return {
      field,
      current: safeString(row?.current, 1000),
      candidate: safeString(row?.candidate, 1000),
    };
  }).filter(Boolean).slice(0, ACCOUNT_REVIEW_FIELDS.length);
  out.changed_fields = (Array.isArray(value.changed_fields) ? value.changed_fields : [])
    .map((field) => safeString(field, 40))
    .filter((field) => ACCOUNT_REVIEW_FIELDS.includes(field))
    .slice(0, ACCOUNT_REVIEW_FIELDS.length);
  out.provenance = pickScalars(value.provenance, {
    text: [['source', 160], ['tier', 160], ['confidence', 80]],
    booleans: ['refreshed'],
  });
  out.applied = value.applied === true;
  return out;
}

function sanitizeEmailQuoteIntakeLine(line) {
  if (!line || typeof line !== 'object') return null;
  const qty = Number(line.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 99999) return null;
  const status = ['resolved', 'needs_edition', 'needs_term', 'unsupported'].includes(line.status)
    ? line.status : 'unsupported';
  const sku = safeString(line.sku, 160).trim().toUpperCase();
  const family = safeString(line.family, 80).trim().toUpperCase();
  const out = { status, qty };
  if (/^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(sku)) out.sku = sku;
  if (/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(family)) out.family = family;
  // Per-row quote tier is needed only for an accurate inert restored-card
  // display. Keep a tiny canonical allowlist; explicit LIC-* rows already
  // encode their tier and must not carry redundant modifier metadata.
  const tier = safeString(line.tier, 40).trim().toUpperCase();
  if (!sku.startsWith('LIC-') && ['ENT', 'SEC', 'SDW', 'A'].includes(tier)) out.tier = tier;
  if (line.edition != null) out.edition = safeString(line.edition, 40).toUpperCase();
  if (Number.isInteger(Number(line.term_years)) && Number(line.term_years) > 0 && Number(line.term_years) <= 20) {
    out.term_years = Number(line.term_years);
  }
  if (line.options && typeof line.options === 'object') {
    const editions = (Array.isArray(line.options.editions) ? line.options.editions : [])
      .map((item) => safeString(item, 40).toUpperCase())
      .filter((item) => /^[A-Z][A-Z0-9_-]{0,39}$/.test(item))
      .slice(0, 20);
    const terms = (Array.isArray(line.options.terms) ? line.options.terms : [])
      .map(Number).filter((item) => Number.isInteger(item) && item > 0 && item <= 20).slice(0, 20);
    const skuMatrix = {};
    for (const edition of editions) {
      const rawTerms = line.options.sku_matrix?.[edition];
      if (!rawTerms || typeof rawTerms !== 'object') continue;
      const mapped = {};
      for (const term of terms) {
        const mappedSku = safeString(rawTerms[String(term)], 160).trim().toUpperCase();
        if (/^[A-Z0-9][A-Z0-9._/-]{1,79}$/.test(mappedSku)) mapped[String(term)] = mappedSku;
      }
      if (Object.keys(mapped).length) skuMatrix[edition] = mapped;
    }
    out.options = { editions, terms, sku_matrix: skuMatrix };
  }
  return out.sku || out.family ? out : null;
}

function sanitizeOneshotPlan(value) {
  const p = value && typeof value === 'object' ? value : {};
  const out = {};
  if (p.customer && typeof p.customer === 'object') {
    const customer = pickScalars(p.customer, { text: [['status', 80]] });
    for (const key of ['contact', 'suggested']) {
      const person = sanitizeOneshotPerson(p.customer[key]);
      if (person) customer[key] = person;
    }
    for (const key of ['candidates', 'vendors']) {
      const people = (Array.isArray(p.customer[key]) ? p.customer[key] : []).map(sanitizeOneshotPerson).filter(Boolean).slice(0, 50);
      if (people.length) customer[key] = people;
    }
    out.customer = customer;
  }
  if (p.account && typeof p.account === 'object') {
    const account = pickScalars(p.account, { text: [['mode', 40], ['id', 160], ['name', 500], ['website', 1000]] });
    account.billing = sanitizeAccountValues(p.account.billing);
    account.missing_fields = (Array.isArray(p.account.missing_fields) ? p.account.missing_fields : [])
      .map((field) => safeString(field, 80)).filter(Boolean).slice(0, 20);
    account.candidates = (Array.isArray(p.account.candidates) ? p.account.candidates : [])
      .map(sanitizeOneshotPerson).filter(Boolean).slice(0, 20);
    if (p.account.prefill && typeof p.account.prefill === 'object') {
      account.prefill = {
        ...sanitizeAccountValues(p.account.prefill),
        ...pickScalars(p.account.prefill, {
          text: [['enrich_tier', 160], ['enrich_confidence', 80], ['enrich_error', 300]],
          booleans: ['enrich_retryable'],
        }),
      };
      const provenance = sanitizeFieldProvenance(p.account.prefill.field_provenance);
      if (Object.keys(provenance).length) account.prefill.field_provenance = provenance;
    }
    const provenance = sanitizeFieldProvenance(p.account.field_provenance);
    if (Object.keys(provenance).length) account.field_provenance = provenance;
    const comparison = sanitizeEnrichmentComparison(p.account.enrichment_comparison);
    if (comparison) account.enrichment_comparison = comparison;
    out.account = account;
  }
  if (p.contact && typeof p.contact === 'object') {
    const contact = pickScalars(p.contact, {
      text: [['mode', 40], ['id', 160], ['name', 300], ['email', 320]],
      booleans: ['last_name_placeholder'],
    });
    const linked = sanitizeOneshotPerson(p.contact.linked_account);
    if (linked) contact.linked_account = linked;
    if (p.contact.defaults && typeof p.contact.defaults === 'object') {
      contact.defaults = pickScalars(p.contact.defaults, {
        text: [['first_name', 300], ['last_name', 300]],
        booleans: ['from_real_name', 'account_it_fallback'],
      });
    }
    out.contact = contact;
  }
  if (p.deal && typeof p.deal === 'object') {
    const deal = pickScalars(p.deal, { text: [['mode', 40], ['existing_deal_id', 160]], booleans: ['read_failed'] });
    deal.open_deals = (Array.isArray(p.deal.open_deals) ? p.deal.open_deals : [])
      .map(sanitizeOneshotPerson).filter(Boolean).slice(0, 20);
    out.deal = deal;
  }
  if (p.isr && typeof p.isr === 'object') {
    const isr = pickScalars(p.isr, { text: [['status', 80], ['query', 320]] });
    const rep = sanitizeOneshotPerson(p.isr.rep);
    if (rep) isr.rep = rep;
    isr.candidates = (Array.isArray(p.isr.candidates) ? p.isr.candidates : [])
      .map(sanitizeOneshotPerson).filter(Boolean).slice(0, 20);
    out.isr = isr;
  }
  if (p.date && typeof p.date === 'object') {
    out.date = pickScalars(p.date, {
      text: [['suggested', 40], ['fiscal_quarter_end', 40]],
      numbers: ['days_to_month_end'],
      booleans: ['needs_confirmation'],
    });
  }
  if (p.ha && typeof p.ha === 'object') {
    out.ha = pickScalars(p.ha, {
      text: [['hardware_sku', 160], ['shared_license_sku', 160], ['ratio', 20]],
      numbers: ['hardware_qty', 'shared_license_qty'],
      booleans: ['license_qty_recalculated', 'recalculation_confirmed'],
    });
  }
  out.lines = (Array.isArray(p.lines) ? p.lines : []).map((line) => pickScalars(line, {
    text: [['sku', 160], ['replaced_by', 160]],
    numbers: ['qty', 'ecomm_price', 'list_price'],
    booleans: ['found', 'product_active', 'eol'],
  })).filter((line) => line.sku && Number.isFinite(line.qty)).slice(0, MAX_STORED_QUOTE_ITEMS);
  if (Number.isFinite(p.total_ecomm)) out.total_ecomm = Number(p.total_ecomm);
  if (p.lead_source != null) out.lead_source = safeString(p.lead_source, 160);
  if (p.ha_mode != null) out.ha_mode = p.ha_mode === 'warm_spare' ? 'warm_spare' : 'standard';
  if (p.product_validation && typeof p.product_validation === 'object') {
    out.product_validation = pickScalars(p.product_validation, {
      text: [['plan_id', 200], ['snapshot_hash', 300], ['catalog_version', 200], ['catalog_hash', 300]],
      numbers: ['product_validation_count'],
      booleans: ['reused'],
    });
  }
  const comparison = sanitizeEnrichmentComparison(p.enrichment_comparison);
  if (comparison) out.enrichment_comparison = comparison;
  return out;
}

function sanitizeOneshotBlockers(values) {
  return (Array.isArray(values) ? values : []).map((blocker) => {
    const out = pickScalars(blocker, {
      text: [['code', 120], ['sku', 160], ['query', 320], ['expected', 160], ['received', 160], ['replaced_by', 160]],
      numbers: ['qty'],
      booleans: ['advisory', 'read_failed', 'evidence_only'],
    });
    return ONESHOT_BLOCKER_CODES.has(out.code) ? out : null;
  }).filter(Boolean).slice(0, 100);
}

function sanitizeOneshotBase(value) {
  const source = value && typeof value === 'object' ? value : {};
  const base = pickScalars(source, {
    text: [
      ['contact_email', 320], ['contact_name', 300], ['source', 100], ['account_id', 160],
      ['account_name', 500], ['account_website_domain', 300], ['domain', 300], ['existing_deal_id', 160],
      ['lead_source', 160], ['meraki_isr_email', 320], ['meraki_isr_name', 300], ['license_term', 40],
    ],
    numbers: ['term_years'],
    booleans: ['renewal', 'license_only', 'hardware_only', 'include_licenses', 'ha_recalculate_license_qty', 'ha_available', 'reactivate_inactive_isr'],
  });
  base.skus = cleanSkuLines(source.skus);
  base.participants = (Array.isArray(source.participants) ? source.participants : []).map(sanitizeOneshotPerson).filter(Boolean).slice(0, 50);
  base.ha_mode = source.ha_mode === 'warm_spare' ? 'warm_spare' : 'standard';
  return base;
}

function sanitizeOneshotExecutePayload(value) {
  const source = value && typeof value === 'object' ? value : {};
  const payload = pickScalars(source, {
    text: [
      ['idempotency_key', 240], ['review_token', MAX_STORED_ONESHOT_TOKEN_CHARS], ['source', 100],
      ['license_term', 40], ['closing_date', 40], ['lead_source', 160], ['meraki_isr_email', 320],
      ['cisco_billing_term', 80], ['deal_name', 500],
    ],
    booleans: [
      'renewal', 'license_only', 'hardware_only', 'include_licenses', 'ha_recalculate_license_qty',
      'reactivate_inactive_isr', 'date_beyond_quarter_confirmed',
    ],
  });
  payload.skus = cleanSkuLines(source.skus);
  payload.participants = (Array.isArray(source.participants) ? source.participants : []).map(sanitizeOneshotPerson).filter(Boolean).slice(0, 50);
  if (source.ha_mode != null) payload.ha_mode = source.ha_mode === 'warm_spare' ? 'warm_spare' : 'standard';
  if (source.account && typeof source.account === 'object') {
    if (source.account.id) payload.account = pickScalars(source.account, { text: [['id', 160], ['name', 500]] });
    else if (source.account.create && typeof source.account.create === 'object') {
      payload.account = { create: {
        ...pickScalars(source.account.create, { text: [['name', 500]] }),
        billing: pickScalars(source.account.create.billing, {
          text: [['street', 500], ['city', 300], ['state', 160], ['zip', 80], ['country', 160]],
        }),
      } };
    }
  }
  if (source.contact && typeof source.contact === 'object') {
    if (source.contact.id) payload.contact = pickScalars(source.contact, { text: [['id', 160]] });
    else if (source.contact.create && typeof source.contact.create === 'object') {
      payload.contact = { create: pickScalars(source.contact.create, {
        text: [['first_name', 300], ['last_name', 300], ['name', 500], ['email', 320]],
      }) };
    }
  }
  if (source.deal && typeof source.deal === 'object') {
    payload.deal = pickScalars(source.deal, { text: [['existing_deal_id', 160]], booleans: ['new', 'confirmed'] });
  }
  return payload;
}

function sanitizeZohoRecordUrl(value) {
  const raw = safeString(value, 2000);
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === ZOHO_HOST && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

function sanitizeOneshotRecords(value) {
  const source = value && typeof value === 'object' ? value : {};
  const records = {};
  for (const key of ['account', 'contact', 'deal', 'quote']) {
    const record = pickScalars(source[key], { text: [['id', 160], ['name', 500]] });
    const url = sanitizeZohoRecordUrl(source[key]?.url);
    if (url) record.url = url;
    if (Object.keys(record).length) records[key] = record;
  }
  return records;
}

function sanitizeStoredEmailQuoteIntake(message) {
  const lines = (Array.isArray(message?.intake?.lines) ? message.intake.lines : [])
    .map(sanitizeEmailQuoteIntakeLine).filter(Boolean).slice(0, MAX_STORED_QUOTE_ITEMS);
  return {
    kind: 'email-quote-intake',
    // Gmail intent, participants, and message provenance are deliberately not
    // persisted with this card. Mark the restored copy so the sidebar can
    // render the safe parsed rows but require a fresh Gmail extraction before
    // it can rebuild or hand anything to the one-shot workflow.
    restored: true,
    busy: false,
    intake: {
      lines,
      extract_error: safeString(message?.intake?.extract_error, 1000) || null,
    },
  };
}

function sanitizeStoredOneshotMessage(message) {
  if (message?.consentSource !== 'quote-card-button') return null;
  const reviewToken = safeString(message.reviewToken, MAX_STORED_ONESHOT_TOKEN_CHARS).trim();
  const idempotencyKey = safeString(message.idempotencyKey, 240).trim();
  const base = sanitizeOneshotBase(message.base);
  if (!reviewToken || !idempotencyKey || !base || cleanSkuLines(base.skus).length === 0) return null;
  base.skus = cleanSkuLines(base.skus);
  base.ha_mode = base.ha_mode === 'warm_spare' ? 'warm_spare' : 'standard';

  const plan = sanitizeOneshotPlan(message.plan);
  const planSnapshotHash = safeString(plan?.product_validation?.snapshot_hash, 300).trim();
  const quoteOptionsSnapshotHash = safeString(message.quoteOptionsSnapshotHash, 300).trim();
  const optionsAreBound = !!planSnapshotHash && quoteOptionsSnapshotHash === planSnapshotHash;
  const quoteOptions = (optionsAreBound && Array.isArray(message.quoteOptions) ? message.quoteOptions : [])
    .map((option, index) => {
      const url = sanitizeStoredOrderUrl(option?.url || option);
      if (!url) return null;
      const termYears = Number(option?.termYears);
      return {
        url,
        label: safeCustomerVisibleString(option?.label, 160) || `Option ${index + 1}`,
        // Preserve only the reviewed quote-option semantics needed to re-plan
        // safely after a side-panel reload. The kind/group keep same-term
        // renewal and EOL-refresh alternatives distinct; product search
        // results, editor drafts, and every other option field stay excluded.
        hardwareOnly: option?.hardwareOnly === true,
        optionKind: safeCustomerVisibleString(option?.optionKind, 40),
        optionGroupId: safeCustomerVisibleString(option?.optionGroupId, 100),
        termYears: Number.isInteger(termYears) && termYears >= 1 && termYears <= 5
          ? termYears
          : null,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_STORED_QUOTE_URLS);
  const selected = Number.isInteger(message.selectedQuoteOptionIndex)
    ? message.selectedQuoteOptionIndex
    : NaN;
  const accountDraft = {};
  for (const field of ['name', 'street', 'city', 'state', 'zip', 'country', 'website']) {
    const value = safeCustomerVisibleString(message?.accountDraft?.[field], field === 'website' ? 1000 : 500);
    if (value) accountDraft[field] = value;
  }
  const executeAttempted = message.executeAttempted === true;
  const executePayload = executeAttempted ? sanitizeOneshotExecutePayload(message.executePayload) : null;
  if (executeAttempted && (!executePayload || executePayload.review_token !== reviewToken || executePayload.idempotency_key !== idempotencyKey)) {
    return null;
  }
  return {
    kind: 'oneshot',
    consentSource: 'quote-card-button',
    busy: false,
    executed: message.executed === true,
    executeAttempted,
    executePayload: executeAttempted ? executePayload : undefined,
    plan,
    blockers: sanitizeOneshotBlockers(message.blockers),
    base,
    quoteOptions,
    selectedQuoteOptionIndex: Number.isInteger(selected) && selected >= 0 && selected < quoteOptions.length ? selected : null,
    quoteOptionsSnapshotHash: quoteOptions.length ? quoteOptionsSnapshotHash : undefined,
    reviewToken,
    reviewExpiresAt: safeString(message.reviewExpiresAt, 100),
    planRevision: Math.max(0, Math.min(100, Number(message.planRevision) || 0)),
    accountDraft: Object.keys(accountDraft).length ? accountDraft : undefined,
    idempotencyKey,
    records: message.executed ? sanitizeOneshotRecords(message.records) : undefined,
  };
}

function cleanContact(contact) {
  if (!contact || typeof contact !== 'object') return null;
  const email = safeString(contact.email, 320).trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    name: safeString(contact.name, 200).trim(),
    role: safeString(contact.role, 40).trim(),
  };
}

function cleanStringList(values, maxItems, maxChars) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => safeString(value, maxChars).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function createChatSessionId(now = Date.now(), random = Math.random()) {
  return `chat_${Number(now).toString(36)}_${Number(random).toString(36).slice(2, 10)}`;
}

export function sanitizeLockedEmailContext(context) {
  if (!context || context.empty) return null;
  const threadPermId = safeString(context.threadPermId, 300).trim();
  const subject = safeString(context.subject, 500).trim();
  const senderEmail = safeString(context.senderEmail, 320).trim().toLowerCase();
  const hasIdentity = !!(threadPermId || subject || senderEmail);
  if (!hasIdentity) return null;

  const body = safeString(context.fullThreadBody || context.body, MAX_LOCKED_EMAIL_BODY_CHARS);
  const contacts = Array.isArray(context.threadContacts)
    ? context.threadContacts.map(cleanContact).filter(Boolean).slice(0, 50)
    : [];

  return {
    threadPermId: threadPermId || null,
    subject,
    body: safeString(context.body, MAX_LOCKED_EMAIL_BODY_CHARS),
    fullThreadBody: body,
    senderEmail,
    senderName: safeString(context.senderName, 200).trim(),
    customerEmail: safeString(context.customerEmail, 320).trim().toLowerCase(),
    customerName: safeString(context.customerName, 200).trim(),
    customerDomain: safeString(context.customerDomain, 255).trim().toLowerCase(),
    isOutbound: !!context.isOutbound,
    threadContacts: contacts,
    allEmails: cleanStringList(context.allEmails, 50, 320),
    allDomains: cleanStringList(context.allDomains, 50, 255),
    ciscoEmails: cleanStringList(context.ciscoEmails, 20, 320),
    threadOrderUrls: cleanStringList(context.threadOrderUrls, 30, 2000),
    ccwDealNumber: safeString(context.ccwDealNumber, 100).trim(),
    isCiscoNotification: !!context.isCiscoNotification,
    extractedAt: Number(context.extractedAt) || Date.now(),
  };
}

export function sanitizeLockedZohoContext(context) {
  if (!context || !context.recordId || !context.module) return null;
  return {
    type: 'zoho',
    page: 'record',
    module: safeString(context.module, 80),
    recordId: safeString(context.recordId, 80),
    recordName: safeString(context.recordName, 500),
    accountId: safeString(
      context.module === 'Accounts' ? context.recordId : context.accountId,
      80,
    ) || null,
    accountName: safeString(context.accountName, 500) || null,
    email: safeString(context.email, 320).toLowerCase() || null,
    website: safeString(context.website, 500) || null,
    tabName: safeString(context.tabName, 80) || null,
    detectedAt: Number(context.detectedAt) || Date.now(),
  };
}

export function createContextLock({
  pageUrl = '',
  tabId = null,
  emailContext = null,
  zohoContext = null,
  now = Date.now(),
} = {}) {
  const url = safeString(pageUrl, 4000);
  const base = {
    lockedAt: Number(now) || Date.now(),
    lockedFromTabId: Number.isInteger(tabId) ? tabId : null,
    sourceUrl: url,
    sourceAvailable: true,
    provenance: 'user-explicit',
  };

  if (url.startsWith(GMAIL_PREFIX)) {
    const snapshot = sanitizeLockedEmailContext(emailContext);
    if (snapshot) return { ...base, kind: 'gmail', snapshot };
  }

  let isZoho = false;
  try { isZoho = new URL(url).hostname === ZOHO_HOST; } catch (_) { /* ignore */ }
  if (isZoho) {
    const snapshot = sanitizeLockedZohoContext(zohoContext);
    if (snapshot) return { ...base, kind: 'zoho', snapshot };
  }

  return { ...base, kind: 'none', snapshot: null };
}

export function normalizeContextLock(lock) {
  if (!lock || lock.provenance !== 'user-explicit') return null;
  const base = {
    lockedAt: Number(lock.lockedAt) || Date.now(),
    lockedFromTabId: Number.isInteger(lock.lockedFromTabId) ? lock.lockedFromTabId : null,
    sourceUrl: safeString(lock.sourceUrl, 4000),
    sourceAvailable: lock.sourceAvailable !== false,
    provenance: 'user-explicit',
  };
  if (lock.kind === 'gmail') {
    const snapshot = sanitizeLockedEmailContext(lock.snapshot);
    return snapshot ? { ...base, kind: 'gmail', snapshot } : { ...base, kind: 'gmail', snapshot: null };
  }
  if (lock.kind === 'zoho') {
    const snapshot = sanitizeLockedZohoContext(lock.snapshot);
    return snapshot ? { ...base, kind: 'zoho', snapshot } : { ...base, kind: 'zoho', snapshot: null };
  }
  return { ...base, kind: 'none', snapshot: null };
}

export function resolveLockedContexts(lock, liveEmailContext, liveZohoContext) {
  const normalized = normalizeContextLock(lock);
  if (!normalized) {
    return {
      locked: false,
      emailContext: liveEmailContext || null,
      zohoContext: liveZohoContext || null,
      ignoreLivePage: false,
    };
  }
  return {
    locked: true,
    emailContext: normalized.kind === 'gmail' ? normalized.snapshot : null,
    zohoContext: normalized.kind === 'zoho' ? normalized.snapshot : null,
    ignoreLivePage: true,
  };
}

export function hasEffectiveZohoRecord({
  contextLock,
  liveZohoContext,
  manualPinnedRecord,
  autoPinnedRecord,
} = {}) {
  const normalized = normalizeContextLock(contextLock);
  if (normalized) {
    return normalized.kind === 'zoho' && !!normalized.snapshot?.recordId;
  }
  return !!(
    liveZohoContext?.recordId
    || manualPinnedRecord?.recordId
    || autoPinnedRecord?.recordId
  );
}

export function effectivePinnedZohoRecord({
  contextLock,
  manualPinnedRecord,
  autoPinnedRecord,
} = {}) {
  const normalized = normalizeContextLock(contextLock);
  if (normalized) return normalized.kind === 'zoho' ? normalized.snapshot : null;
  return manualPinnedRecord || autoPinnedRecord || null;
}

export function lockedEmailBodyUnavailable(lock) {
  const normalized = normalizeContextLock(lock);
  return normalized?.kind === 'gmail'
    && !safeString(normalized.snapshot?.fullThreadBody || normalized.snapshot?.body, MAX_LOCKED_EMAIL_BODY_CHARS).trim();
}

export function shouldBlockForActiveZohoMismatch({
  activeRecordId,
  outgoingText,
  manualPinnedRecord,
  autoPinnedRecord,
  contextLock,
} = {}) {
  if (!activeRecordId) return false;
  if (normalizeContextLock(contextLock)) return false;
  if (safeString(outgoingText, 50000).includes(String(activeRecordId))) return false;
  if (manualPinnedRecord?.recordId && manualPinnedRecord.module !== 'Accounts') return false;
  if (autoPinnedRecord?.recordId && safeString(outgoingText, 50000).includes(String(autoPinnedRecord.recordId))) return false;
  return true;
}

export function isLockSourceAvailable(lock, tab) {
  const normalized = normalizeContextLock(lock);
  if (!normalized || normalized.lockedFromTabId == null || !tab) return false;
  if (tab.id !== normalized.lockedFromTabId) return false;
  const url = safeString(tab.url, 4000);
  if (normalized.kind === 'gmail') return url.startsWith(GMAIL_PREFIX) && url === normalized.sourceUrl;
  if (normalized.kind === 'zoho') {
    try {
      const parsed = new URL(url);
      return parsed.hostname === ZOHO_HOST && parsed.pathname.includes(normalized.snapshot?.recordId || '__missing__');
    } catch (_) {
      return false;
    }
  }
  return url === normalized.sourceUrl;
}

export function contextLockLabel(lock) {
  const normalized = normalizeContextLock(lock);
  if (!normalized) return 'Context unlocked';
  if (normalized.kind === 'gmail') {
    return normalized.snapshot
      ? `Gmail: ${safeString(normalized.snapshot.subject || 'thread', 80)}`
      : 'Gmail context unavailable';
  }
  if (normalized.kind === 'zoho') {
    const moduleLabel = ({ Quotes: 'Quote', Potentials: 'Deal', Deals: 'Deal', Accounts: 'Account', Contacts: 'Contact' })[normalized.snapshot?.module]
      || normalized.snapshot?.module
      || 'Zoho record';
    return normalized.snapshot
      ? `${moduleLabel}: ${safeString(normalized.snapshot.recordName || normalized.snapshot.recordId, 80)}`
      : 'Zoho context unavailable';
  }
  return 'No page context';
}

export function contextLockReportMetadata(lock) {
  const normalized = normalizeContextLock(lock);
  if (!normalized) return null;
  return {
    kind: normalized.kind,
    lockedAt: normalized.lockedAt,
    sourceAvailable: normalized.sourceAvailable,
    hasSnapshot: !!normalized.snapshot,
    // Intentionally omit snapshot, sourceUrl, subjects, email addresses, names,
    // record ids, and thread text from outbound issue reports.
  };
}

function sanitizeStoredMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = ['user', 'assistant', 'system'].includes(message.role)
    ? message.role
    : 'assistant';
  const common = {
    id: (typeof message.id === 'number' || typeof message.id === 'string')
      ? message.id
      : createChatSessionId(),
    role,
    timestamp: safeString(message.timestamp, 100),
  };
  if (role === 'assistant' && message.kind === 'quote') {
    if (message.draftDirty === true) {
      return {
        ...common,
        content: '[quote draft changed; stale interactive links were not retained across the panel reload]',
      };
    }
    const quote = sanitizeStoredQuoteMessage(message);
    if (quote) return { ...common, ...quote };
  }
  if (role === 'assistant' && message.kind === 'email-quote-intake') {
    return { ...common, ...sanitizeStoredEmailQuoteIntake(message) };
  }
  if (role === 'assistant' && message.kind === 'oneshot') {
    const oneshot = sanitizeStoredOneshotMessage(message);
    if (oneshot) return { ...common, ...oneshot };
  }
  const genericCardSummary = message.kind
    ? `[${safeString(message.kind, 60)} result from this chat; interactive card details are not retained across a panel reload]`
    : '';
  const content = safeString(message.content || genericCardSummary, MAX_STORED_MESSAGE_CHARS);
  return {
    ...common,
    content,
  };
}

export function serializeChatSession({ sessionId, messages, autoPinnedRecord, manualPinnedRecord, contextLock } = {}) {
  return {
    version: 1,
    sessionId: safeString(sessionId, 120) || createChatSessionId(),
    messages: Array.isArray(messages)
      ? messages.map(sanitizeStoredMessage).filter(Boolean).slice(-MAX_LOCKED_MESSAGES)
      : [],
    autoPinnedRecord: sanitizeLockedZohoContext(autoPinnedRecord),
    manualPinnedRecord: sanitizeLockedZohoContext(manualPinnedRecord),
    contextLock: normalizeContextLock(contextLock),
  };
}

export function normalizeStoredChatSession(value) {
  if (!value || value.version !== 1 || !value.sessionId) return null;
  return serializeChatSession(value);
}

export function createEmptyChatSession(now = Date.now(), random = Math.random()) {
  return serializeChatSession({
    sessionId: createChatSessionId(now, random),
    messages: [],
    autoPinnedRecord: null,
    manualPinnedRecord: null,
    contextLock: null,
  });
}
