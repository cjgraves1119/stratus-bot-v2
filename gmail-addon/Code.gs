/**
 * Stratus AI Gmail Add-on — Main Entry Points
 *
 * Homepage trigger, contextual email trigger, and compose trigger.
 * Each function returns a Card or array of Cards to display in the sidebar.
 */

// ─────────────────────────────────────────────
// HOMEPAGE TRIGGER (add-on icon clicked, no email context)
// ─────────────────────────────────────────────

function onHomepage(e) {
  return buildHomepageCard_();
}

// ─────────────────────────────────────────────
// CONTEXTUAL TRIGGER (email opened)
// ─────────────────────────────────────────────

function onGmailMessage(e) {
  // Get the current email
  const accessToken = e.gmail.accessToken;
  GmailApp.setCurrentMessageAccessToken(accessToken);
  const messageId = e.gmail.messageId;

  let message;
  try {
    message = GmailApp.getMessageById(messageId);
  } catch (err) {
    return buildErrorCard_('Could not read this email. Please try reopening it.');
  }

  const subject = message.getSubject() || '(no subject)';
  const body = message.getPlainBody() || '';
  const from = message.getFrom() || '';

  // Parse sender
  const senderParts = parseSender_(from);

  // Store email context for later actions (draft reply, etc.)
  const emailCtx = {
    messageId: messageId,
    subject: subject,
    body: body.substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderEmail: senderParts.email,
    senderName: senderParts.name,
    threadId: message.getThread().getId(),
  };

  // Save to properties so action handlers can retrieve it
  PropertiesService.getUserProperties().setProperty(
    'current_email_ctx',
    JSON.stringify(emailCtx)
  );

  // Call the API to analyze the email
  let analysis;
  try {
    analysis = analyzeEmail_(subject, body, senderParts.email, senderParts.name);
  } catch (err) {
    console.error('analyzeEmail_ error: ' + err.message);
    // Return a degraded card with basic info + manual actions
    return buildDegradedEmailCard_(subject, senderParts, err.message);
  }

  return buildEmailAnalysisCard_(subject, senderParts, analysis);
}

// ─────────────────────────────────────────────
// COMPOSE TRIGGER (insert quote into draft)
// ─────────────────────────────────────────────

function onComposeInsertQuote(e) {
  return buildQuoteBuilderCard_();
}

// ─────────────────────────────────────────────
// ACTION HANDLERS (button clicks from cards)
// ─────────────────────────────────────────────

/**
 * Handle "Generate Quote" button from either homepage or email card.
 */
function onGenerateQuote(e) {
  const skuText = e.formInput.sku_input;
  if (!skuText || skuText.trim() === '') {
    return buildNotificationAction_('Please enter SKUs first.');
  }

  let result;
  try {
    result = generateQuote_(skuText.trim());
  } catch (err) {
    return buildErrorCard_('Quote generation failed: ' + err.message);
  }

  return buildQuoteResultCard_(result);
}

/**
 * Handle "Look Up in CRM" button.
 */
function onCrmLookup(e) {
  const query = e.parameters.query || '';
  const module = e.parameters.module || 'Accounts';

  if (!query) {
    return buildErrorCard_('No search term provided.');
  }

  let result;
  try {
    result = crmSearch_(query, module);
  } catch (err) {
    return buildErrorCard_('CRM lookup failed: ' + err.message);
  }

  return buildCrmResultCard_(result, query, module);
}

/**
 * Handle "Draft Reply" button.
 */
function onDraftReply(e) {
  const tone = (e.parameters && e.parameters.tone) || 'warm';
  const ctx = getEmailContext_();
  if (!ctx) {
    return buildErrorCard_('No email context. Please reopen the email.');
  }

  let result;
  try {
    result = draftReply_(ctx.subject, ctx.body, ctx.senderEmail, ctx.senderName, tone, '');
  } catch (err) {
    return buildErrorCard_('Draft generation failed: ' + err.message);
  }

  return buildDraftReplyCard_(result, ctx);
}

/**
 * Handle "Draft Reply with Instructions" — user provided custom instructions.
 */
function onDraftReplyCustom(e) {
  const instructions = e.formInput.reply_instructions || '';
  const tone = e.formInput.reply_tone || 'warm';
  const ctx = getEmailContext_();
  if (!ctx) {
    return buildErrorCard_('No email context. Please reopen the email.');
  }

  let result;
  try {
    result = draftReply_(ctx.subject, ctx.body, ctx.senderEmail, ctx.senderName, tone, instructions);
  } catch (err) {
    return buildErrorCard_('Draft generation failed: ' + err.message);
  }

  return buildDraftReplyCard_(result, ctx);
}

/**
 * Handle "Insert into Gmail Draft" — creates a Gmail draft reply.
 */
function onInsertDraft(e) {
  const draftBody = e.parameters.draft_body || '';
  const ctx = getEmailContext_();
  if (!ctx || !draftBody) {
    return buildNotificationAction_('Nothing to insert.');
  }

  try {
    const thread = GmailApp.getThreadById(ctx.threadId);
    const messages = thread.getMessages();
    const lastMessage = messages[messages.length - 1];

    // Create a reply draft
    lastMessage.createDraftReply(draftBody);

    return CardService.newActionResponseBuilder()
      .setNotification(
        CardService.newNotification().setText('Draft created! Check your Drafts folder.')
      )
      .build();
  } catch (err) {
    return buildNotificationAction_('Could not create draft: ' + err.message);
  }
}

/**
 * Handle "Detect SKUs in Email" button.
 */
function onDetectSkus(e) {
  const ctx = getEmailContext_();
  if (!ctx) {
    return buildErrorCard_('No email context. Please reopen the email.');
  }

  let result;
  try {
    result = detectSkus_(ctx.body);
  } catch (err) {
    return buildErrorCard_('SKU detection failed: ' + err.message);
  }

  if (result.skus && result.skus.length > 0) {
    // Pre-fill the quote builder with detected SKUs
    return buildQuoteBuilderCard_(result.skus.map(s => s.qty + ' ' + s.sku).join(', '));
  } else {
    return buildNotificationAction_('No Cisco/Meraki SKUs detected in this email.');
  }
}

/**
 * Handle CRM search from the homepage.
 */
function onCrmSearch(e) {
  const query = e.formInput.crm_search_input;
  const module = e.formInput.crm_module || 'Accounts';

  if (!query || query.trim() === '') {
    return buildNotificationAction_('Please enter a search term.');
  }

  let result;
  try {
    result = crmSearch_(query.trim(), module);
  } catch (err) {
    return buildErrorCard_('CRM search failed: ' + err.message);
  }

  return buildCrmResultCard_(result, query.trim(), module);
}

// ─────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Parse "Display Name <email@example.com>" into parts.
 */
function parseSender_(fromField) {
  const emailMatch = fromField.match(/<([^>]+)>/);
  const email = emailMatch ? emailMatch[1] : fromField.trim();
  const name = emailMatch
    ? fromField.replace(/<[^>]+>/, '').replace(/"/g, '').trim()
    : email.split('@')[0];
  return { email: email, name: name || email };
}

/**
 * Retrieve stored email context from user properties.
 */
function getEmailContext_() {
  try {
    const raw = PropertiesService.getUserProperties().getProperty('current_email_ctx');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Build a notification-only action response.
 */
function buildNotificationAction_(text) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(text))
    .build();
}
