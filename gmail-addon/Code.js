/**
 * Stratus AI Gmail Add-on — Main Entry Points & Action Handlers
 *
 * Lazy-loading design: sidebar opens instantly with action buttons.
 * AI analysis, tasks, and drafts are triggered on-demand by button clicks.
 */

// ─────────────────────────────────────────────
// HOMEPAGE TRIGGER
// ─────────────────────────────────────────────

function onHomepage(e) {
  return buildHomepageCard_();
}

// ─────────────────────────────────────────────
// CONTEXTUAL TRIGGER (email opened) — LAZY LOAD
// ─────────────────────────────────────────────

function onGmailMessage(e) {
  var accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  var messageId = e.gmail.messageId;

  var message;
  try {
    message = GmailApp.getMessageById(messageId);
  } catch (err) {
    return buildErrorCard_('Could not read this email. Please try reopening it.');
  }

  var subject = message.getSubject() || '(no subject)';
  var body = message.getPlainBody() || '';
  var from = message.getFrom() || '';
  var senderParts = parseSender_(from);

  // Single-pass: collect all emails, domains, and external contacts from thread
  var STRATUS_DOMAIN = 'stratusinfosystems.com';
  var isOutbound = (senderParts.email.toLowerCase().indexOf('@' + STRATUS_DOMAIN) !== -1);
  var thread = message.getThread();
  var messages = thread.getMessages();
  var allEmails = {};
  var allDomains = {};
  var threadContacts = [];
  var seenContactEmails = {};
  var customerEmail = '';
  var customerName = '';
  var customerDomain = '';
  var lastInboundBody = null;

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var msgFrom = msg.getFrom() || '';
    var contactFields = [msgFrom, msg.getTo() || '', msg.getCc() || ''];
    var combinedFields = contactFields.join(', ');

    // Extract all emails for domain collection
    var emailMatches = combinedFields.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
    for (var j = 0; j < emailMatches.length; j++) {
      var email = emailMatches[j].toLowerCase();
      allEmails[email] = true;
      var domain = email.split('@')[1];
      if (domain) allDomains[domain] = true;
    }

    // Extract external contacts with names (for contact selector)
    for (var cf = 0; cf < contactFields.length; cf++) {
      var addresses = contactFields[cf].split(',');
      for (var ca = 0; ca < addresses.length; ca++) {
        var addr = addresses[ca].trim();
        if (!addr) continue;
        var parsed = parseSender_(addr);
        if (!parsed.email) continue;
        var lowerEmail = parsed.email.toLowerCase();
        if (lowerEmail.indexOf('@' + STRATUS_DOMAIN) !== -1) continue;
        if (seenContactEmails[lowerEmail]) continue;
        seenContactEmails[lowerEmail] = true;
        threadContacts.push({ email: parsed.email, name: parsed.name });
        if (!customerEmail) {
          customerEmail = parsed.email;
          customerName = parsed.name;
          customerDomain = parsed.email.split('@')[1] || '';
        }
      }
    }

    // Track last inbound message body (for outbound emails)
    if (isOutbound && customerEmail) {
      var fromParsed = parseSender_(msgFrom);
      if (fromParsed.email.toLowerCase().indexOf('@' + STRATUS_DOMAIN) === -1) {
        lastInboundBody = msg.getPlainBody();
      }
    }
  }

  var bodyToUse = (isOutbound && lastInboundBody) ? lastInboundBody : body;

  // Store email context for action handlers (no API call here)
  var emailCtx = {
    messageId: messageId,
    subject: subject,
    body: bodyToUse.substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderEmail: senderParts.email,
    senderName: senderParts.name,
    customerEmail: customerEmail,
    customerName: customerName,
    customerDomain: customerDomain,
    isOutbound: isOutbound,
    threadId: thread.getId(),
    allEmails: Object.keys(allEmails),
    allDomains: Object.keys(allDomains),
    threadContacts: threadContacts,
    threadMessageCount: messages.length,
    openedAt: new Date().getTime(),
  };
  PropertiesService.getUserProperties().setProperty(
    'current_email_ctx', JSON.stringify(emailCtx)
  );

  // Auto-load CRM contact on email open (zero AI cost)
  var primaryEmail = (isOutbound && customerEmail) ? customerEmail : senderParts.email;
  var primaryDomain = primaryEmail ? primaryEmail.split('@')[1] || '' : '';
  var crmData = null;

  // Skip consumer domains
  if (!/^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac)\./.test(primaryDomain)) {
    try {
      crmData = crmContactLookup_(primaryEmail, primaryDomain);
      if (crmData && crmData.found) {
        PropertiesService.getUserProperties().setProperty('crm_sidebar_ctx', JSON.stringify({
          contact: crmData.contact || null,
          account: crmData.account || null,
        }));
      }
    } catch (_) { /* CRM lookup failure is non-fatal */ }
  }

  return buildInstantEmailCard_(subject, senderParts, emailCtx, crmData);
}

// ─────────────────────────────────────────────
// COMPOSE TRIGGER
// ─────────────────────────────────────────────

function onComposeInsertQuote(e) {
  return buildQuoteBuilderCard_('');
}

// ─────────────────────────────────────────────
// ACTION HANDLERS
// ─────────────────────────────────────────────

/** Generate Quote button */
function onGenerateQuote(e) {
  var skuText = e.formInput.sku_input;
  if (!skuText || skuText.trim() === '') {
    return notify_('Please enter SKUs first.');
  }

  var result;
  try {
    result = generateQuote_(skuText.trim());
  } catch (err) {
    return buildErrorCard_('Quote generation failed: ' + err.message);
  }
  return buildQuoteResultCard_(result);
}

/** AI Analysis (triggered by button, not auto) */
function onAnalyzeEmail(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  var result;
  try {
    result = analyzeEmail_(ctx.subject, ctx.body, ctx.senderEmail, ctx.senderName);
  } catch (err) {
    return buildErrorCard_('Analysis failed: ' + err.message);
  }

  return buildEmailAnalysisCard_(ctx.subject, { email: ctx.senderEmail, name: ctx.senderName }, result);
}

/** View Tasks for all accounts in this thread */
function onViewTasks(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  var result;
  try {
    result = fetchTasks_(ctx.allDomains || [], ctx.allEmails || []);
  } catch (err) {
    return buildErrorCard_('Task lookup failed: ' + err.message);
  }

  return buildTaskCard_(result, ctx);
}

/** Task action: complete and create follow-up */
function onTaskComplete(e) {
  var taskId = e.parameters.task_id || '';
  var dealId = e.parameters.deal_id || '';
  var contactId = e.parameters.contact_id || '';
  var subject = e.parameters.task_subject || 'Follow up: next steps';

  if (!taskId) return notify_('No task ID.');

  var result;
  try {
    result = taskAction_('complete_and_followup', taskId, {
      dealId: dealId,
      contactId: contactId,
      newSubject: 'Follow up: ' + subject,
    });
  } catch (err) {
    return buildErrorCard_('Task action failed: ' + err.message);
  }

  return buildTaskResultCard_(result);
}

/** Task action: close/complete only (no follow-up) */
function onTaskCloseOnly(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  var taskId = params.task_id || '';
  if (!taskId) return notify_('No task ID.');

  var result;
  try {
    result = taskAction_('complete', taskId, {});
  } catch (err) {
    return buildErrorCard_('Close failed: ' + err.message);
  }

  return buildTaskResultCard_(result);
}

/** Task action: reschedule to +3 business days */
function onTaskReschedule(e) {
  var taskId = (e.commonEventObject && e.commonEventObject.parameters ? e.commonEventObject.parameters.task_id : '') || (e.parameters ? e.parameters.task_id : '') || '';
  if (!taskId) return notify_('No task ID.');

  var newDate = addBusinessDays_(new Date(), 3);

  var result;
  try {
    result = taskAction_('reschedule', taskId, {
      newDueDate: formatDate_(newDate),
    });
  } catch (err) {
    return buildErrorCard_('Reschedule failed: ' + err.message);
  }

  return buildTaskResultCard_(result);
}

/** Show inline edit form for a task */
function onTaskShowEdit(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  return buildTaskEditCard_(params);
}

/** Task action: save edits (subject and/or date) */
function onTaskEdit(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  var taskId = params.task_id || '';
  if (!taskId) return notify_('No task ID.');

  var formInput = e.formInput || {};
  var newSubject = (formInput.edit_subject || '').trim();

  // Handle DatePicker input
  var newDueDate = '';
  var dateInputs = e.commonEventObject ? e.commonEventObject.formInputs : null;
  if (dateInputs && dateInputs.edit_due_date && dateInputs.edit_due_date.dateInput) {
    var ms = dateInputs.edit_due_date.dateInput.msSinceEpoch;
    if (ms) {
      var d = new Date(parseInt(ms));
      newDueDate = formatDate_(d);
    }
  }
  if (!newDueDate && formInput.edit_due_date) {
    newDueDate = (formInput.edit_due_date || '').trim();
  }

  if (!newSubject && !newDueDate) {
    return notify_('Enter a new subject or date.');
  }

  var options = {};
  if (newSubject) options.newSubject = newSubject;
  if (newDueDate) options.newDueDate = newDueDate;

  var result;
  try {
    result = taskAction_('edit', taskId, options);
  } catch (err) {
    return buildErrorCard_('Edit failed: ' + err.message);
  }

  return buildTaskResultCard_(result);
}

/** CRM lookup from email card (sender auto-filled) */
function onCrmLookup(e) {
  var query = e.parameters.query || '';
  var module = e.parameters.module || 'Accounts';
  if (!query) return buildErrorCard_('No search term provided.');

  var result;
  try {
    result = crmSearch_(query, module);
  } catch (err) {
    return buildErrorCard_('CRM lookup failed: ' + err.message);
  }
  return buildCrmResultCard_(result, query, module);
}

/** CRM search from homepage */
function onCrmSearch(e) {
  var query = e.formInput.crm_search_input;
  var module = e.formInput.crm_module || 'Accounts';
  if (!query || query.trim() === '') {
    return notify_('Please enter a search term.');
  }

  var result;
  try {
    result = crmSearch_(query.trim(), module);
  } catch (err) {
    return buildErrorCard_('CRM search failed: ' + err.message);
  }
  return buildCrmResultCard_(result, query.trim(), module);
}

/** Show Add Contact form (pre-filled from email context) */
function onShowAddContact(e) {
  var ctx = getEmailContext_();
  var crmCtx = null;
  try { crmCtx = JSON.parse(PropertiesService.getUserProperties().getProperty('crm_sidebar_ctx') || 'null'); } catch (_) {}

  // Pre-fill from email context
  var prefillEmail = '';
  var prefillName = '';
  var accountId = '';
  var accountName = '';

  if (ctx) {
    prefillEmail = (ctx.isOutbound && ctx.customerEmail) ? ctx.customerEmail : ctx.senderEmail;
    prefillName = (ctx.isOutbound && ctx.customerName) ? ctx.customerName : ctx.senderName;
  }
  if (crmCtx && crmCtx.account) {
    accountId = crmCtx.account.id || '';
    accountName = crmCtx.account.name || '';
  }

  // Split name into first/last
  var nameParts = (prefillName || '').trim().split(/\s+/);
  var firstName = nameParts[0] || '';
  var lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

  return buildAddContactCard_(firstName, lastName, prefillEmail, '', '', accountId, accountName);
}

/** Submit Add Contact form */
function onAddContact(e) {
  var form = e.formInput || {};
  var firstName = (form.contact_first_name || '').trim();
  var lastName = (form.contact_last_name || '').trim();
  var email = (form.contact_email || '').trim();
  var phone = (form.contact_phone || '').trim();
  var title = (form.contact_title || '').trim();

  if (!lastName && !email) {
    return notify_('Last name or email is required.');
  }

  // Get account ID from parameters (passed from the form card)
  var accountId = (e.commonEventObject && e.commonEventObject.parameters)
    ? (e.commonEventObject.parameters.account_id || '')
    : (e.parameters ? (e.parameters.account_id || '') : '');

  var result;
  try {
    result = crmAddContact_(firstName, lastName, email, phone, title, accountId);
  } catch (err) {
    return buildErrorCard_('Contact creation failed: ' + err.message);
  }

  if (result && result.duplicate) {
    return buildContactCreatedCard_(result, true);
  }
  if (result && result.success) {
    return buildContactCreatedCard_(result, false);
  }
  return buildErrorCard_('Contact creation failed: ' + (result ? result.error : 'Unknown error'));
}

/** Show Draft Reply form (tone selector + instructions) */
function onShowDraftReply(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');
  return buildDraftReplyFormCard_(ctx);
}

/** Quick draft reply (tone button from form) */
function onDraftReply(e) {
  var tone = (e.parameters && e.parameters.tone) || 'warm';
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  // Use the external customer's info when the open message is outbound.
  var replyToEmail = (ctx.isOutbound && ctx.customerEmail) ? ctx.customerEmail : ctx.senderEmail;
  var replyToName  = (ctx.isOutbound && ctx.customerName)  ? ctx.customerName  : ctx.senderName;

  var result;
  try {
    result = draftReply_(ctx.subject, ctx.body, replyToEmail, replyToName, tone, '');
  } catch (err) {
    return buildErrorCard_('Draft generation failed: ' + err.message);
  }
  return buildDraftReplyCard_(result, ctx);
}

/** Custom draft reply with instructions */
function onDraftReplyCustom(e) {
  var instructions = e.formInput.reply_instructions || '';
  var tone = e.formInput.reply_tone || 'warm';
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  // Use the external customer's info when the open message is outbound.
  var replyToEmail = (ctx.isOutbound && ctx.customerEmail) ? ctx.customerEmail : ctx.senderEmail;
  var replyToName  = (ctx.isOutbound && ctx.customerName)  ? ctx.customerName  : ctx.senderName;

  var result;
  try {
    result = draftReply_(ctx.subject, ctx.body, replyToEmail, replyToName, tone, instructions);
  } catch (err) {
    return buildErrorCard_('Draft generation failed: ' + err.message);
  }
  return buildDraftReplyCard_(result, ctx);
}

/** Send to Stratus AI — called by the "Send to Google Chat →" button */
function onSendToStratusAI(e) {
  var requestText = e.formInput ? e.formInput.stratus_request : null;
  if (!requestText || requestText.trim() === '') {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please enter a request before sending.'))
      .build();
  }

  var emailContext = buildEmailContextForHandoff_(e);
  if (!emailContext) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Could not read email context. Please close and reopen the email.'))
      .build();
  }

  var result;
  try {
    result = sendHandoffRequest_(requestText.trim(), emailContext);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Request failed: ' + err.message))
      .build();
  }

  var notifText;
  if (result && result.success) {
    notifText = 'Sent! Check Google Chat for your response from Stratus AI.';
  } else if (result && result.error && result.error.indexOf('No Google Chat space') !== -1) {
    notifText = 'Setup needed: Send any message to Stratus AI in Google Chat first, then try again.';
  } else {
    notifText = 'Something went wrong. ' + (result && result.error ? result.error.substring(0, 80) : 'Try again.');
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(notifText))
    .build();
}

/** Send to Stratus AI from homepage — no email context required */
function onSendToStratusAIFromHome(e) {
  var requestText = e.formInput ? e.formInput.home_stratus_request : null;
  if (!requestText || requestText.trim() === '') {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please enter a request before sending.'))
      .build();
  }

  var result;
  try {
    result = sendHandoffRequest_(requestText.trim(), null);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Request failed: ' + err.message))
      .build();
  }

  var notifText;
  if (result && result.success) {
    notifText = 'Sent! Check Google Chat for your response from Stratus AI.';
  } else if (result && result.error && result.error.indexOf('No Google Chat space') !== -1) {
    notifText = 'Setup needed: Send any message to Stratus AI in Google Chat first, then try again.';
  } else {
    notifText = 'Something went wrong. ' + (result && result.error ? result.error.substring(0, 80) : 'Try again.');
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(notifText))
    .build();
}

/** Build email context object for the handoff request */
function buildEmailContextForHandoff_(e) {
  try {
    var raw = PropertiesService.getUserProperties().getProperty('current_email_ctx');
    if (!raw) return null;
    var ctx = JSON.parse(raw);

    // If the currently-open message is an outbound reply (Chris sent it),
    // use the external customer's email/name for CRM lookups instead of Chris's.
    // This prevents the bot from creating records under Stratus Information Systems.
    var contactEmail = (ctx.isOutbound && ctx.customerEmail)
      ? ctx.customerEmail
      : (ctx.senderEmail || '');
    var contactName = (ctx.isOutbound && ctx.customerName)
      ? ctx.customerName
      : (ctx.senderName || ctx.senderEmail || '');

    var senderDomain = '';
    if (contactEmail && contactEmail.indexOf('@') !== -1) {
      senderDomain = contactEmail.split('@')[1] || '';
    }
    return {
      subject:      ctx.subject      || '(no subject)',
      senderEmail:  contactEmail,
      senderName:   contactName,
      senderDomain: senderDomain,
      body:         (ctx.body || '').substring(0, 2000),
      accountName:  ctx.accountName  || null,
      isOutbound:   ctx.isOutbound   || false,
    };
  } catch (err) {
    console.error('[HANDOFF] buildEmailContextForHandoff_ error: ' + err.message);
    return null;
  }
}

/**
 * One-time setup: manually register your Google Chat DM space.
 * Set MY_GCHAT_SPACE in Script Properties (e.g. spaces/XXXXXXXXX),
 * or just send any message to the Stratus AI bot in Google Chat — it registers automatically.
 */
function registerMyGchatSpace() {
  var spaceName = PropertiesService.getScriptProperties().getProperty('MY_GCHAT_SPACE');
  if (!spaceName) {
    Logger.log('Set MY_GCHAT_SPACE in Script Properties, or send any message to Stratus AI bot in GChat (auto-registers).');
    return;
  }
  var result = registerGchatSpace_(spaceName);
  Logger.log('Registration result: ' + JSON.stringify(result));
}

/** Insert draft into Gmail */
function onInsertDraft(e) {
  var draftBody = e.parameters.draft_body || '';
  var ctx = getEmailContext_();
  if (!ctx || !draftBody) return notify_('Nothing to insert.');

  try {
    var thread = GmailApp.getThreadById(ctx.threadId);
    var messages = thread.getMessages();
    var lastMessage = messages[messages.length - 1];
    lastMessage.createDraftReply(draftBody);

    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Draft created! Check your Drafts folder.'))
      .build();
  } catch (err) {
    return notify_('Could not create draft: ' + err.message);
  }
}

/** Detect SKUs in email body and prefill quote builder */
function onDetectSkus(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  var result;
  try {
    result = detectSkus_(ctx.body);
  } catch (err) {
    return buildErrorCard_('SKU detection failed: ' + err.message);
  }

  if (result.skus && result.skus.length > 0) {
    return buildQuoteBuilderCard_(result.skus.map(function(s) { return s.qty + ' ' + s.sku; }).join(', '));
  } else {
    return notify_('No Cisco/Meraki SKUs detected in this email.');
  }
}

// ─────────────────────────────────────────────
// CREATE ZOHO QUOTE (email context → CRM)
// ─────────────────────────────────────────────

/**
 * Step 1: Detect SKUs from the email and show a pre-populated
 * Zoho Quote builder card with editable fields.
 */
function onCreateZohoQuote(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  // Auto-detect SKUs from the email body
  var detectedSkus = [];
  try {
    var result = detectSkus_(ctx.body);
    if (result && result.skus) {
      detectedSkus = result.skus;
    }
  } catch (err) {
    // SKU detection failed — continue without pre-populated SKUs
    console.error('[ZOHO-QUOTE] SKU detection error: ' + err.message);
  }

  // Format detected SKUs as editable text
  var skuText = '';
  if (detectedSkus.length > 0) {
    skuText = detectedSkus.map(function(s) {
      return s.qty + ' ' + s.sku;
    }).join(', ');
  }

  // Build the Zoho quote card
  return buildZohoQuoteCard_(ctx, skuText);
}

/**
 * Step 2: Send the Zoho quote request to Stratus AI via GChat handoff.
 * The handoff text is structured to trigger CRM intent with explicit
 * "Zoho quote" language so the bot creates in CRM, not a URL quote.
 */
function onConfirmZohoQuote(e) {
  var formInput = e.formInput || {};
  var skuText = (formInput.zoho_quote_skus || '').trim();
  var licenseTerm = formInput.zoho_quote_license_term || '1Y';
  var additionalNotes = (formInput.zoho_quote_notes || '').trim();

  if (!skuText) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Please enter at least one SKU.'))
      .build();
  }

  // Reconstruct email context
  var emailContext = buildEmailContextForHandoff_(e);

  // Build a structured CRM request message
  var requestParts = [
    'Create a Zoho CRM quote with the following:',
    'Products: ' + skuText,
    'License term: ' + licenseTerm,
  ];

  if (emailContext) {
    if (emailContext.senderName && emailContext.senderName !== emailContext.senderEmail) {
      requestParts.push('Contact: ' + emailContext.senderName + ' (' + emailContext.senderEmail + ')');
    } else if (emailContext.senderEmail) {
      requestParts.push('Contact email: ' + emailContext.senderEmail);
    }
    if (emailContext.accountName) {
      requestParts.push('Account: ' + emailContext.accountName);
    } else if (emailContext.senderDomain) {
      requestParts.push('Look up the account by domain: ' + emailContext.senderDomain);
    }
  }

  if (additionalNotes) {
    requestParts.push('Notes: ' + additionalNotes);
  }

  requestParts.push('Include hardware and matching licenses at list price. Create the deal if one does not exist, and create a follow-up task.');

  var handoffText = requestParts.join('\n');

  var result;
  try {
    result = sendHandoffRequest_(handoffText, emailContext);
  } catch (err) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification().setText('Request failed: ' + err.message))
      .build();
  }

  var notifText;
  if (result && result.success && result.pending) {
    // Worker is still processing (took >25s) — it continues running in the
    // background and will deliver results to Google Chat when done.
    notifText = 'Working on it — results will appear in Google Chat in a few minutes. ✅';
  } else if (result && result.success) {
    notifText = 'Zoho quote request sent! Check Google Chat for progress.';
  } else if (result && result.error && result.error.indexOf('No Google Chat space') !== -1) {
    notifText = 'Setup needed: Send any message to Stratus AI in Google Chat first.';
  } else {
    notifText = 'Something went wrong. ' + (result && result.error ? result.error.substring(0, 80) : 'Try again.');
  }

  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(notifText))
    .build();
}

// ─────────────────────────────────────────────
// CRM SIDEBAR HANDLERS (zero AI cost)
// ─────────────────────────────────────────────

/** Open CRM Contact Details sidebar (entry point) */
function onCrmContactDetails(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  // Use customer email (thread-aware) over raw sender
  var lookupEmail = (ctx.isOutbound && ctx.customerEmail) ? ctx.customerEmail : ctx.senderEmail;
  var lookupDomain = (ctx.isOutbound && ctx.customerDomain) ? ctx.customerDomain : (lookupEmail ? lookupEmail.split('@')[1] : '');

  // Skip generic consumer domains
  if (/^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac)\./.test(lookupDomain)) {
    lookupDomain = '';
  }

  var result;
  try {
    result = crmContactLookup_(lookupEmail, lookupDomain);
  } catch (err) {
    return buildErrorCard_('CRM lookup failed: ' + err.message);
  }

  if (!result || !result.found) {
    return buildErrorCard_('No contact or account found in Zoho CRM for ' + lookupEmail + '. Try searching manually.');
  }

  // Store CRM context for tab navigation
  var crmCtx = {
    contact: result.contact || null,
    account: result.account || null,
  };
  PropertiesService.getUserProperties().setProperty('crm_sidebar_ctx', JSON.stringify(crmCtx));

  // Build card with Info tab
  var card = buildCrmSidebarCard_(crmCtx, 'info');
  buildCrmInfoTab_(card, crmCtx.contact, crmCtx.account);
  addBackToEmailButton_(card);
  return card.build();
}

/** Switch to a different thread contact (via dropdown) */
function onContactSwitch(e) {
  // Read from dropdown formInputs (SelectionInput)
  var selectedEmail = '';
  var fi = e.commonEventObject.formInputs || {};
  if (fi.contact_selector && fi.contact_selector.stringInputs) {
    var vals = fi.contact_selector.stringInputs.value || [];
    if (vals.length > 0) selectedEmail = vals[0];
  }
  // Fallback to parameters (for legacy button clicks)
  if (!selectedEmail) {
    var params = e.commonEventObject.parameters || {};
    selectedEmail = params.contact_email || '';
  }
  if (!selectedEmail) return notify_('No contact selected.');

  var domain = selectedEmail.split('@')[1] || '';

  // Skip consumer domains
  if (/^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac)\./.test(domain)) {
    domain = '';
  }

  var result;
  try {
    result = crmContactLookup_(selectedEmail, domain);
  } catch (err) {
    return buildErrorCard_('CRM lookup failed: ' + err.message);
  }

  if (!result || !result.found) {
    return buildErrorCard_('No CRM record found for ' + selectedEmail + '.');
  }

  var crmCtx = {
    contact: result.contact || null,
    account: result.account || null,
  };
  PropertiesService.getUserProperties().setProperty('crm_sidebar_ctx', JSON.stringify(crmCtx));

  // Rebuild email card with this contact's CRM data
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context.');
  return buildInstantEmailCard_(ctx.subject, { email: ctx.senderEmail, name: ctx.senderName }, ctx, result);
}

/** Handle CRM tab navigation */
function onCrmTab(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  var tab = params.tab || 'info';
  var contactId = params.contact_id || '';
  var accountId = params.account_id || '';
  var contactEmail = params.contact_email || '';

  // Load cached CRM context
  var crmCtx;
  try {
    var raw = PropertiesService.getUserProperties().getProperty('crm_sidebar_ctx');
    crmCtx = raw ? JSON.parse(raw) : { contact: null, account: null };
  } catch (_) {
    crmCtx = { contact: null, account: null };
  }

  // Override with params if CRM context is stale
  if (!crmCtx.contact && contactId) crmCtx.contact = { id: contactId, email: contactEmail };
  if (!crmCtx.account && accountId) crmCtx.account = { id: accountId };

  var tabParams = {
    contact_id: contactId || (crmCtx.contact ? crmCtx.contact.id : ''),
    account_id: accountId || (crmCtx.account ? crmCtx.account.id : ''),
    contact_email: contactEmail || (crmCtx.contact ? crmCtx.contact.email : ''),
  };

  var card = buildCrmSidebarCard_(crmCtx, tab);

  try {
    if (tab === 'info') {
      buildCrmInfoTab_(card, crmCtx.contact, crmCtx.account);
    } else if (tab === 'deals') {
      var dealsResult = crmDeals_(tabParams.account_id, tabParams.contact_email);
      buildCrmDealsTab_(card, dealsResult);
    } else if (tab === 'tasks') {
      var tasksResult = crmActivities_(tabParams.account_id, tabParams.contact_id);
      buildCrmTasksTab_(card, tasksResult, tabParams);
    } else if (tab === 'quotes') {
      var quotesResult = crmQuotes_(tabParams.account_id, '');
      buildCrmQuotesTab_(card, quotesResult);
    }
  } catch (err) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">Error loading ' + tab + ': ' + err.message + '</font>')
      )
    );
  }

  addBackToEmailButton_(card);
  return card.build();
}

/** Add a note to a CRM record */
function onCrmAddNote(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  var parentModule = params.parent_module || 'Contacts';
  var parentId = params.parent_id || '';
  var noteContent = e.formInput ? e.formInput.crm_note_content : '';

  if (!parentId || !noteContent || noteContent.trim() === '') {
    return notify_('Please enter a note first.');
  }

  var result;
  try {
    result = crmAddNote_(parentModule, parentId, '', noteContent.trim());
  } catch (err) {
    return notify_('Failed to add note: ' + err.message);
  }

  if (result && result.success) {
    return notify_('Note added successfully.');
  } else {
    return notify_('Failed: ' + (result ? result.message || result.error : 'Unknown error'));
  }
}

/** Show create task form */
function onCrmShowCreateTask(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  return buildCrmCreateTaskCard_(params);
}

/** Create a new CRM task */
function onCrmCreateTask(e) {
  var params = e.commonEventObject.parameters || e.parameters || {};
  var formInput = e.formInput || {};
  var subject = (formInput.new_task_subject || '').trim();
  var priority = formInput.new_task_priority || 'Normal';
  var description = (formInput.new_task_description || '').trim();

  // Handle DatePicker input (returns {msSinceEpoch} object) or text fallback
  var dueDate = '';
  var dateInputs = e.commonEventObject ? e.commonEventObject.formInputs : null;
  if (dateInputs && dateInputs.new_task_due && dateInputs.new_task_due.dateInput) {
    var ms = dateInputs.new_task_due.dateInput.msSinceEpoch;
    if (ms) {
      var d = new Date(parseInt(ms));
      dueDate = formatDate_(d);
    }
  }
  if (!dueDate && formInput.new_task_due) {
    dueDate = (formInput.new_task_due || '').trim();
  }

  if (!subject) {
    return notify_('Please enter a task subject.');
  }

  var contactId = params.contact_id || '';
  var accountId = params.account_id || '';

  // Use deal from dropdown if provided, otherwise find most recent open deal
  var dealId = formInput.new_task_deal || '';
  if (accountId && !dealId) {
    try {
      var dealsResp = crmDeals_(accountId, '');
      if (dealsResp && dealsResp.deals && dealsResp.deals.length > 0) {
        for (var i = 0; i < dealsResp.deals.length; i++) {
          var dd = dealsResp.deals[i];
          if (dd.stage !== 'Closed Won' && dd.stage !== 'Closed (Lost)') {
            dealId = dd.id;
            break;
          }
        }
        if (!dealId) dealId = dealsResp.deals[0].id;
      }
    } catch (_) { /* proceed without deal */ }
  }

  var result;
  try {
    result = crmCreateTask_(subject, dueDate, dealId, contactId, priority, description);
  } catch (err) {
    return buildErrorCard_('Task creation failed: ' + err.message);
  }

  if (result && result.success) {
    var card = CardService.newCardBuilder()
      .setHeader(
        CardService.newCardHeader()
          .setTitle('Task Created')
          .setSubtitle(subject)
          .setImageStyle(CardService.ImageStyle.CIRCLE)
          .setImageUrl(CONFIG.ICON_URL)
      );

    var section = CardService.newCardSection();
    section.addWidget(
      CardService.newTextParagraph().setText('Task created successfully.')
    );

    if (result.zohoUrl) {
      section.addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText('Open in Zoho')
            .setOpenLink(CardService.newOpenLink().setUrl(result.zohoUrl))
        )
      );
    }

    card.addSection(section);
    addBackToEmailButton_(card);
    return card.build();
  } else {
    return buildErrorCard_('Task creation failed: ' + (result ? result.message || result.error : 'Unknown error'));
  }
}

/** Navigate back to homepage */
function onBackToHome(e) {
  return buildHomepageCard_();
}

/** Navigate back to instant email card */
function onBackToEmail(e) {
  var ctx = getEmailContext_();
  if (!ctx) return buildHomepageCard_();
  return buildInstantEmailCard_(ctx.subject, { email: ctx.senderEmail, name: ctx.senderName });
}

/** Copy text notification */
function onCopyText(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(
      'Clipboard not available in add-ons. Use "Create Gmail Draft" instead.'
    ))
    .build();
}

/**
 * Suggest and create a follow-up task.
 * First calls preview mode to show what will happen, then executes on confirm.
 */
function onSuggestTask(e) {
  var params = e.commonEventObject.parameters || {};
  var senderEmail = params.sender_email || '';
  var senderName = params.sender_name || '';
  var subject = params.subject || '';
  var hasAccount = params.has_account === 'true';
  var accountId = params.account_id || '';
  var threadDomains = (params.thread_domains || '').split(',').filter(function(d) { return d; });

  try {
    // Preview mode: check what would happen (account/contact lookup only)
    var preview = apiCall_('/api/suggest-task-preview', {
      senderEmail: senderEmail,
      senderName: senderName,
      subject: subject,
      hasAccount: hasAccount,
      accountId: accountId,
      threadDomains: threadDomains
    });
    return buildSuggestTaskPreviewCard_(preview, params);
  } catch (err) {
    return buildErrorCard_('Task suggestion failed: ' + err.message);
  }
}

/**
 * Execute the suggested task creation after user confirms.
 */
function onConfirmSuggestTask(e) {
  var params = e.commonEventObject.parameters || {};
  var senderEmail = params.sender_email || '';
  var senderName = params.sender_name || '';
  var subject = params.subject || '';
  var hasAccount = params.has_account === 'true';
  var accountId = params.account_id || '';
  var createContact = params.create_contact === 'true';
  var threadDomains = (params.thread_domains || '').split(',').filter(function(d) { return d; });

  try {
    var result = apiCall_('/api/suggest-task', {
      senderEmail: senderEmail,
      senderName: senderName,
      subject: subject,
      hasAccount: hasAccount,
      accountId: accountId,
      createContact: createContact,
      threadDomains: threadDomains
    });
    return buildTaskResultCard_(result);
  } catch (err) {
    return buildErrorCard_('Task creation failed: ' + err.message);
  }
}

/**
 * View Admin dashboard (API usage stats).
 */
function onViewAdmin(e) {
  try {
    var result = apiCall_('/api/admin-usage', {});
    return buildAdminCard_(result);
  } catch (err) {
    return buildErrorCard_('Admin data failed: ' + err.message);
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function parseSender_(fromField) {
  var emailMatch = fromField.match(/<([^>]+)>/);
  var email = emailMatch ? emailMatch[1] : fromField.trim();
  var name = emailMatch
    ? fromField.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
    : email.split('@')[0];
  return { email: email, name: name || email };
}

function getEmailContext_() {
  try {
    var raw = PropertiesService.getUserProperties().getProperty('current_email_ctx');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function notify_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}

function truncate_(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function capitalize_(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Add N business days (skip weekends) to a date.
 */
function addBusinessDays_(startDate, days) {
  var d = new Date(startDate.getTime());
  var added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/**
 * Format date as YYYY-MM-DD.
 */
function formatDate_(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// ─────────────────────────────────────────────
// REPLY DETECTION
// ─────────────────────────────────────────────

/**
 * Check if the current thread has new messages since the sidebar loaded.
 * Returns { replied: true, newCount: N } if new messages from Stratus found.
 */
function checkForReply_() {
  var ctx = getEmailContext_();
  if (!ctx || !ctx.threadId) return { replied: false };

  var storedCount = ctx.threadMessageCount || 0;
  if (storedCount === 0) return { replied: false };

  try {
    var thread = GmailApp.getThreadById(ctx.threadId);
    if (!thread) return { replied: false };
    var currentCount = thread.getMessageCount();

    if (currentCount > storedCount) {
      // Check if any of the new messages are from Stratus (i.e. Chris replied)
      var msgs = thread.getMessages();
      var STRATUS_DOMAIN = 'stratusinfosystems.com';
      var newStratusMessages = [];
      for (var i = storedCount; i < msgs.length; i++) {
        var fromEmail = (msgs[i].getFrom() || '').toLowerCase();
        if (fromEmail.indexOf('@' + STRATUS_DOMAIN) !== -1) {
          newStratusMessages.push({
            from: msgs[i].getFrom(),
            date: msgs[i].getDate(),
            snippet: (msgs[i].getPlainBody() || '').substring(0, 100),
          });
        }
      }

      if (newStratusMessages.length > 0) {
        // Update stored count so we don't re-trigger
        ctx.threadMessageCount = currentCount;
        PropertiesService.getUserProperties().setProperty(
          'current_email_ctx', JSON.stringify(ctx)
        );
        return {
          replied: true,
          newCount: currentCount - storedCount,
          stratusReplies: newStratusMessages,
          customerEmail: ctx.customerEmail,
          customerName: ctx.customerName,
          subject: ctx.subject,
          threadId: ctx.threadId,
        };
      }
    }
    return { replied: false };
  } catch (err) {
    return { replied: false };
  }
}

/**
 * Action handler: user clicked "Check for Reply" or triggered by interaction.
 * Shows reply-detected card with follow-up task options.
 */
function onCheckReply(e) {
  var result = checkForReply_();
  if (!result.replied) {
    return notify_('No new replies detected in this thread.');
  }
  // Enrich with existing task info so card can offer extend option
  try {
    var crmCtxRaw = PropertiesService.getUserProperties().getProperty('crm_sidebar_ctx');
    var crmCtx = crmCtxRaw ? JSON.parse(crmCtxRaw) : {};
    var contactId = (crmCtx.contact && crmCtx.contact.id) ? crmCtx.contact.id : '';
    var accountId = (crmCtx.account && crmCtx.account.id) ? crmCtx.account.id : '';
    if (contactId || accountId) {
      var activities = crmActivities_(contactId, accountId);
      if (activities && activities.tasks && activities.tasks.length > 0) {
        // Find first open task
        for (var ti = 0; ti < activities.tasks.length; ti++) {
          var t = activities.tasks[ti];
          if (t.status !== 'Completed') {
            result.existingTask = { id: t.id, subject: t.subject, dueDate: t.dueDate };
            break;
          }
        }
      }
    }
  } catch (_) { /* proceed without task info */ }
  return buildReplyDetectedCard_(result);
}

/**
 * Action handler: Create follow-up task after reply detected.
 */
function onCreateReplyFollowup(e) {
  var params = e.commonEventObject.parameters || {};
  var action = params.followup_action || 'create'; // 'create' or 'extend'
  var taskId = params.existing_task_id || '';
  var customerEmail = params.customer_email || '';
  var customerName = params.customer_name || '';
  var subject = params.subject || '';

  var ctx = getEmailContext_();
  var crmCtxRaw = PropertiesService.getUserProperties().getProperty('crm_sidebar_ctx');
  var crmCtx = crmCtxRaw ? JSON.parse(crmCtxRaw) : {};
  var accountId = (crmCtx.account && crmCtx.account.id) ? crmCtx.account.id : '';
  var contactId = (crmCtx.contact && crmCtx.contact.id) ? crmCtx.contact.id : '';

  var dueDate = addBusinessDays_(new Date(), 3);
  var dueDateStr = formatDate_(dueDate);

  try {
    if (action === 'extend' && taskId) {
      // Push existing task out 3 more business days
      var result = taskAction_('reschedule', taskId, {
        newDueDate: dueDateStr,
      });
      return notify_('Task rescheduled to ' + dueDateStr);
    } else {
      // Create new follow-up task via dedicated create endpoint
      var newSubject = 'Follow up: ' + (subject || 'Email reply');
      var dealId = '';
      // Try to get most recent deal from CRM context
      if (accountId) {
        try {
          var dealsData = crmDeals_(accountId, '');
          if (dealsData && dealsData.deals && dealsData.deals.length > 0) {
            dealId = dealsData.deals[0].id;
          }
        } catch (_) { /* proceed without deal */ }
      }
      var result = crmCreateTask_(
        newSubject,
        dueDateStr,
        dealId,
        contactId,
        'Normal',
        'Auto-created after replying to thread: ' + (subject || '')
      );
      return notify_('Follow-up task created for ' + dueDateStr);
    }
  } catch (err) {
    return buildErrorCard_('Failed to create follow-up: ' + err.message);
  }
}
