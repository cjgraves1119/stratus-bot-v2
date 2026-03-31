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

  // Collect ALL emails and domains from the thread
  var thread = message.getThread();
  var messages = thread.getMessages();
  var allEmails = {};
  var allDomains = {};

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    var fields = [msg.getFrom(), msg.getTo(), msg.getCc()].join(', ');
    var emailMatches = fields.match(/[\w.+-]+@[\w.-]+\.\w+/g) || [];
    for (var j = 0; j < emailMatches.length; j++) {
      var email = emailMatches[j].toLowerCase();
      allEmails[email] = true;
      var domain = email.split('@')[1];
      if (domain) allDomains[domain] = true;
    }
  }

  // Identify the external customer (non-Stratus) from the thread.
  // When the most recent message is an outbound reply from Chris, the "sender"
  // is @stratusinfosystems.com — which is wrong for CRM lookups. We walk the
  // thread to find the actual external contact and use their info instead.
  var STRATUS_DOMAIN = 'stratusinfosystems.com';
  var isOutbound = (senderParts.email.toLowerCase().indexOf('@' + STRATUS_DOMAIN) !== -1);
  var customerEmail = '';
  var customerName = '';
  var customerDomain = '';

  // Walk thread messages (chronologically) to find the first external sender.
  for (var k = 0; k < messages.length; k++) {
    var threadMsg = messages[k];
    var fromParsed = parseSender_(threadMsg.getFrom() || '');
    if (fromParsed.email && fromParsed.email.toLowerCase().indexOf('@' + STRATUS_DOMAIN) === -1) {
      customerEmail = fromParsed.email;
      customerName = fromParsed.name;
      customerDomain = fromParsed.email.split('@')[1] || '';
      break;
    }
  }

  // If this is an outbound message, use the body of the most recent inbound
  // message so the AI and CRM agent have the customer's actual content.
  var bodyToUse = body;
  if (isOutbound && customerEmail) {
    for (var k2 = messages.length - 1; k2 >= 0; k2--) {
      var inboundParsed = parseSender_(messages[k2].getFrom() || '');
      if (inboundParsed.email.toLowerCase().indexOf('@' + STRATUS_DOMAIN) === -1) {
        bodyToUse = messages[k2].getPlainBody() || body;
        break;
      }
    }
  }

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
  };
  PropertiesService.getUserProperties().setProperty(
    'current_email_ctx', JSON.stringify(emailCtx)
  );

  // Return instant card — NO API call
  return buildInstantEmailCard_(subject, senderParts);
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

/** Task action: reschedule to +3 business days */
function onTaskReschedule(e) {
  var taskId = e.parameters.task_id || '';
  if (!taskId) return notify_('No task ID.');

  // Calculate 3 business days from today
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

/** Task action: edit with custom subject/date */
function onTaskEdit(e) {
  var taskId = e.parameters.task_id || '';
  if (!taskId) return notify_('No task ID.');

  var newSubject = e.formInput.edit_subject || '';
  var newDueDate = e.formInput.edit_date || '';

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
