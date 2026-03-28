/**
 * Stratus AI Gmail Add-on — Main Entry Points & Action Handlers
 *
 * Homepage trigger, contextual email trigger, compose trigger,
 * and all button action handlers.
 */

// ─────────────────────────────────────────────
// HOMEPAGE TRIGGER
// ─────────────────────────────────────────────

function onHomepage(e) {
  return buildHomepageCard_();
}

// ─────────────────────────────────────────────
// CONTEXTUAL TRIGGER (email opened)
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

  // Store email context for action handlers
  var emailCtx = {
    messageId: messageId,
    subject: subject,
    body: body.substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderEmail: senderParts.email,
    senderName: senderParts.name,
    threadId: message.getThread().getId(),
  };
  PropertiesService.getUserProperties().setProperty(
    'current_email_ctx', JSON.stringify(emailCtx)
  );

  // Try AI analysis; fall back to manual-action card on failure
  var analysis;
  try {
    analysis = analyzeEmail_(subject, body, senderParts.email, senderParts.name);
  } catch (err) {
    console.error('analyzeEmail_ error: ' + err.message);
    return buildEmailManualCard_(subject, senderParts, err.message);
  }

  return buildEmailAnalysisCard_(subject, senderParts, analysis);
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

/** Quick draft reply (tone button) */
function onDraftReply(e) {
  var tone = (e.parameters && e.parameters.tone) || 'warm';
  var ctx = getEmailContext_();
  if (!ctx) return buildErrorCard_('No email context. Please reopen the email.');

  var result;
  try {
    result = draftReply_(ctx.subject, ctx.body, ctx.senderEmail, ctx.senderName, tone, '');
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

  var result;
  try {
    result = draftReply_(ctx.subject, ctx.body, ctx.senderEmail, ctx.senderName, tone, instructions);
  } catch (err) {
    return buildErrorCard_('Draft generation failed: ' + err.message);
  }
  return buildDraftReplyCard_(result, ctx);
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

/** Analyze Email button (manual trigger from email card) */
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

/** Navigate back to homepage */
function onBackToHome(e) {
  return buildHomepageCard_();
}

/** Copy text notification */
function onCopyText(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(
      'Clipboard not available in add-ons. Use "Create Gmail Draft" instead.'
    ))
    .build();
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
