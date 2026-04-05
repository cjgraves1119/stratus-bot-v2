/**
 * Stratus AI Gmail Add-on â Card Builders (v3 lazy-load + tasks)
 *
 * Instant sidebar on email open. AI features triggered by buttons.
 * Task automation with complete/reschedule/edit actions.
 */

// âââââââââââââââââââââââââââââââââââââââââââââ
// HOMEPAGE CARD (no email context)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildHomepageCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Cisco/Meraki Sales Assistant')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ââ Quick Quote ââ
  var quoteSection = CardService.newCardSection()
    .setHeader('Quick Quote')
    .setCollapsible(false);

  quoteSection.addWidget(
    CardService.newTextInput()
      .setFieldName('sku_input')
      .setTitle('Enter SKUs')
      .setHint('e.g. 10 MR44, 5 MS130-24P, 2 MX67')
      .setMultiline(true)
  );

  quoteSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Generate Quote URL')
        .setOnClickAction(CardService.newAction().setFunctionName('onGenerateQuote'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(quoteSection);

  // ââ CRM Search ââ
  var crmSection = CardService.newCardSection()
    .setHeader('CRM Search')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  crmSection.addWidget(
    CardService.newTextInput()
      .setFieldName('crm_search_input')
      .setTitle('Search Zoho CRM')
      .setHint('Account name, contact, or deal')
  );

  crmSection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('crm_module')
      .setTitle('Module')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Accounts', 'Accounts', true)
      .addItem('Contacts', 'Contacts', false)
      .addItem('Deals', 'Deals', false)
      .addItem('Quotes', 'Quotes', false)
  );

  crmSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Search')
        .setOnClickAction(CardService.newAction().setFunctionName('onCrmSearch'))
    )
  );

  card.addSection(crmSection);


  // ── Send to Stratus AI (GChat) ──
  var handoffSection = CardService.newCardSection()
    .setHeader('Send to Stratus AI \u2192 GChat')
    .setCollapsible(false);

  handoffSection.addWidget(
    CardService.newTextParagraph().setText(
      'Send a request to Stratus AI in Google Chat. ' +
      'Use for CRM actions, quoting, or anything that needs the full AI agent.'
    )
  );

  handoffSection.addWidget(
    CardService.newTextInput()
      .setFieldName('home_stratus_request')
      .setTitle('Your request')
      .setHint('e.g. "quote 10 MR44 under deal Ohio Valley Gas"')
      .setMultiline(true)
  );

  handoffSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Send to Stratus AI \u2192 GChat')
        .setOnClickAction(CardService.newAction().setFunctionName('onSendToStratusAIFromHome'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(handoffSection);
  // ââ Info / Help ââ
  var infoSection = CardService.newCardSection()
    .setHeader('Tips')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  infoSection.addWidget(
    CardService.newTextParagraph().setText(
      'Open any email to unlock AI features:\n\n' +
      '- <b>AI Analysis</b> - summary, urgency, action items\n' +
      '- <b>Open Tasks</b> - view/manage Zoho tasks for this account\n' +
      '- <b>Draft Replies</b> - warm, professional, or brief tone\n' +
      '- <b>CRM Lookup</b> - auto-finds sender in Zoho\n' +
      '- <b>SKU Detection</b> - finds Cisco products in emails\n\n' +
      'Use <b>Insert Stratus Quote</b> in the compose menu.'
    )
  );

  card.addSection(infoSection);

  // ââ Admin ââ
  var adminSection = CardService.newCardSection()
    .setHeader('Admin')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  adminSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('API Usage & Stats')
        .setOnClickAction(CardService.newAction().setFunctionName('onViewAdmin'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_DARK)
    )
  );

  card.addSection(adminSection);

  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// INSTANT EMAIL CARD (no API call â loads instantly)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildInstantEmailCard_(subject, sender, emailCtx, crmData) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle(truncate_(subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // Contact selector (all non-Stratus thread participants)
  var contacts = (emailCtx && emailCtx.threadContacts) || [];
  var primaryEmail = '';
  if (crmData && crmData.contact) {
    primaryEmail = crmData.contact.email || '';
  } else if (emailCtx) {
    primaryEmail = (emailCtx.isOutbound && emailCtx.customerEmail) ? emailCtx.customerEmail : emailCtx.senderEmail;
  } else {
    primaryEmail = sender.email;
  }

  if (contacts.length > 0) {
    var contactSection = CardService.newCardSection();

    // Show primary contact prominently
    var primaryContact = null;
    for (var ci = 0; ci < contacts.length; ci++) {
      if (contacts[ci].email.toLowerCase() === primaryEmail.toLowerCase()) {
        primaryContact = contacts[ci];
        break;
      }
    }
    if (!primaryContact) primaryContact = { email: primaryEmail, name: primaryEmail.split('@')[0] };

    var contactWidget = CardService.newDecoratedText()
      .setText('<b>' + (primaryContact.name || primaryContact.email) + '</b>')
      .setBottomLabel(primaryContact.email)
      .setWrapText(true);

    if (crmData && crmData.contact && crmData.contact.zohoUrl) {
      contactWidget.setButton(
        CardService.newTextButton()
          .setText('Zoho')
          .setOpenLink(CardService.newOpenLink().setUrl(crmData.contact.zohoUrl))
      );
    }
    contactSection.addWidget(contactWidget);

    // Dropdown to switch contacts (only if multiple)
    if (contacts.length > 1) {
      var contactDropdown = CardService.newSelectionInput()
        .setFieldName('contact_selector')
        .setTitle('Switch Contact')
        .setType(CardService.SelectionInputType.DROPDOWN)
        .setOnChangeAction(
          CardService.newAction().setFunctionName('onContactSwitch')
        );

      for (var si = 0; si < Math.min(contacts.length, 10); si++) {
        var sc = contacts[si];
        var label = (sc.name && sc.name !== sc.email)
          ? sc.name + ' (' + sc.email + ')'
          : sc.email;
        var isDefault = (sc.email.toLowerCase() === primaryEmail.toLowerCase());
        contactDropdown.addItem(label, sc.email, isDefault);
      }
      contactSection.addWidget(contactDropdown);
    }

    card.addSection(contactSection);
  } else {
    var senderSection = CardService.newCardSection();
    senderSection.addWidget(
      CardService.newDecoratedText()
        .setText(sender.name)
        .setBottomLabel(sender.email)
        .setWrapText(true)
    );
    card.addSection(senderSection);
  }

  // CRM Section (Info | Deals | Tasks tabs)
  if (crmData && crmData.found) {
    var contact = crmData.contact;
    var account = crmData.account;

    if (account && account.name) {
      var acctSection = CardService.newCardSection();
      var acctWidget = CardService.newDecoratedText()
        .setTopLabel('Account')
        .setText(account.name)
        .setWrapText(true);
      if (account.zohoUrl) {
        acctWidget.setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(CardService.newOpenLink().setUrl(account.zohoUrl))
        );
      }
      acctSection.addWidget(acctWidget);
      card.addSection(acctSection);
    }

    // Tab navigation
    var tabSection = CardService.newCardSection();
    var tabParams = {
      contact_id: contact ? contact.id : '',
      account_id: account ? account.id : '',
      contact_email: contact ? contact.email : primaryEmail,
    };

    var tabs = CardService.newButtonSet();
    var tabConfig = [
      { label: 'Info', key: 'info' },
      { label: 'Deals', key: 'deals' },
      { label: 'Tasks', key: 'tasks' },
    ];

    for (var ti = 0; ti < tabConfig.length; ti++) {
      var tParams = {};
      for (var key in tabParams) tParams[key] = tabParams[key];
      tParams.tab = tabConfig[ti].key;

      var tabBtn = CardService.newTextButton()
        .setText(tabConfig[ti].label)
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onCrmTab')
            .setParameters(tParams)
        );

      if (tabConfig[ti].key === 'info') {
        tabBtn.setTextButtonStyle(CardService.TextButtonStyle.FILLED)
              .setBackgroundColor(CONFIG.STRATUS_BLUE);
      }
      tabs.addButton(tabBtn);
    }
    tabSection.addWidget(tabs);
    card.addSection(tabSection);

    // Brief info preview
    if (contact) {
      var previewSection = CardService.newCardSection();
      var previewParts = [];
      if (contact.title) previewParts.push(contact.title);
      if (contact.phone) previewParts.push(contact.phone);
      if (contact.mobile && contact.mobile !== contact.phone) previewParts.push(contact.mobile);
      if (previewParts.length > 0) {
        previewSection.addWidget(
          CardService.newTextParagraph().setText(previewParts.join(' | '))
        );
      }
      card.addSection(previewSection);
    }
  } else {
    var noCrmSection = CardService.newCardSection();
    noCrmSection.addWidget(
      CardService.newTextParagraph().setText('<i>No CRM record found for ' + primaryEmail + '</i>')
    );
    noCrmSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Search CRM')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmContactDetails')
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_DARK)
      )
    );
    card.addSection(noCrmSection);
  }

  // Quick Quote
  var quoteSection = CardService.newCardSection()
    .setHeader('Quick Quote')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(2);

  quoteSection.addWidget(
    CardService.newTextInput()
      .setFieldName('sku_input')
      .setTitle('Enter SKUs')
      .setHint('e.g. 10 MR44, 5 MS130-24P')
      .setMultiline(true)
  );

  quoteSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Generate Quote')
        .setOnClickAction(CardService.newAction().setFunctionName('onGenerateQuote'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(quoteSection);

  // AI Tools
  var actionsSection = CardService.newCardSection()
    .setHeader('AI Tools')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  var actionButtons1 = CardService.newButtonSet();
  actionButtons1.addButton(
    CardService.newTextButton()
      .setText('Analyze Email')
      .setOnClickAction(CardService.newAction().setFunctionName('onAnalyzeEmail'))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor(CONFIG.STRATUS_BLUE)
  );
  actionButtons1.addButton(
    CardService.newTextButton()
      .setText('Draft Reply')
      .setOnClickAction(CardService.newAction().setFunctionName('onShowDraftReply'))
  );
  actionsSection.addWidget(actionButtons1);

  var actionButtons2 = CardService.newButtonSet();
  actionButtons2.addButton(
    CardService.newTextButton()
      .setText('Detect SKUs')
      .setOnClickAction(CardService.newAction().setFunctionName('onDetectSkus'))
  );
  actionButtons2.addButton(
    CardService.newTextButton()
      .setText('Zoho Quote')
      .setOnClickAction(CardService.newAction().setFunctionName('onCreateZohoQuote'))
  );
  actionsSection.addWidget(actionButtons2);

  // Reply detection + Add Contact buttons
  var actionButtons3 = CardService.newButtonSet();
  actionButtons3.addButton(
    CardService.newTextButton()
      .setText('Check for Reply / Create Follow-up')
      .setOnClickAction(CardService.newAction().setFunctionName('onCheckReply'))
  );
  actionButtons3.addButton(
    CardService.newTextButton()
      .setText('Add Contact')
      .setOnClickAction(CardService.newAction().setFunctionName('onShowAddContact'))
  );
  actionsSection.addWidget(actionButtons3);

  card.addSection(actionsSection);

  // Send to Stratus AI (GChat DM handoff)
  var handoffSection = CardService.newCardSection()
    .setHeader('Send to Stratus AI')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  handoffSection.addWidget(
    CardService.newTextInput()
      .setFieldName('stratus_request')
      .setTitle('Your request')
      .setHint('e.g. "Summarize this email and suggest next steps"')
      .setMultiline(true)
  );

  handoffSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Send to Stratus AI \u2192 GChat')
        .setOnClickAction(CardService.newAction().setFunctionName('onSendToStratusAI'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(handoffSection);

  return card.build();
}

// ═══════════════════════════════════════════
// ZOHO QUOTE CARD (pre-populated from email)
// ═══════════════════════════════════════════

function buildZohoQuoteCard_(ctx, skuText) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Create Zoho Quote')
        .setSubtitle(truncate_(ctx.subject || '', 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // —— Email Context ——
  var contextSection = CardService.newCardSection()
    .setHeader('Email Context');

  contextSection.addWidget(
    CardService.newDecoratedText()
      .setText(ctx.senderName || ctx.senderEmail || 'Unknown')
      .setBottomLabel(ctx.senderEmail || '')
      .setWrapText(true)
  );

  if (ctx.subject) {
    contextSection.addWidget(
      CardService.newDecoratedText()
        .setText('Subject: ' + truncate_(ctx.subject, 60))
        .setWrapText(true)
    );
  }

  card.addSection(contextSection);

  // —— SKU Entry ——
  var skuSection = CardService.newCardSection()
    .setHeader('Quote Details');

  skuSection.addWidget(
    CardService.newTextInput()
      .setFieldName('zoho_quote_skus')
      .setTitle('Products / SKUs')
      .setHint('e.g. 10 MR44, 5 MS130-24P, 2 MX85')
      .setMultiline(true)
      .setValue(skuText || '')
  );

  skuSection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('zoho_quote_license_term')
      .setTitle('License Term')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('1 Year', '1Y', true)
      .addItem('3 Year', '3Y', false)
      .addItem('5 Year', '5Y', false)
  );

  skuSection.addWidget(
    CardService.newTextInput()
      .setFieldName('zoho_quote_notes')
      .setTitle('Additional Notes (optional)')
      .setHint('e.g. "Customer needs rack mount kits", "Discount request"')
      .setMultiline(true)
  );

  card.addSection(skuSection);

  // —— Action Buttons ——
  var actionSection = CardService.newCardSection();

  actionSection.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText('Create Quote in Zoho')
          .setOnClickAction(CardService.newAction().setFunctionName('onConfirmZohoQuote'))
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
      .addButton(
        CardService.newTextButton()
          .setText('Back')
          .setOnClickAction(CardService.newAction().setFunctionName('onBackToEmail'))
      )
  );

  card.addSection(actionSection);

  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// EMAIL ANALYSIS CARD (AI analysis succeeded)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildEmailAnalysisCard_(subject, sender, analysis) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('AI Analysis')
        .setSubtitle(truncate_(subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ââ AI Summary ââ
  if (analysis.summary) {
    var summarySection = CardService.newCardSection()
      .setHeader('Summary');

    if (analysis.urgency) {
      var urgencyIcon = analysis.urgency === 'high' ? 'ð´' :
                        analysis.urgency === 'medium' ? 'ð¡' : 'ð¢';
      summarySection.addWidget(
        CardService.newDecoratedText()
          .setText(urgencyIcon + ' ' + capitalize_(analysis.urgency) + ' Priority')
          .setWrapText(true)
      );
    }

    summarySection.addWidget(
      CardService.newTextParagraph().setText(analysis.summary)
    );

    if (analysis.actionItems && analysis.actionItems.length > 0) {
      summarySection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Action Items')
          .setText(analysis.actionItems.map(function(item) {
            return '- ' + item;
          }).join('\n'))
          .setWrapText(true)
      );
    }

    card.addSection(summarySection);
  }

  // ââ Sender & CRM ââ
  var senderSection = CardService.newCardSection()
    .setHeader('Sender & CRM');

  senderSection.addWidget(
    CardService.newDecoratedText()
      .setText(sender.name)
      .setBottomLabel(sender.email)
      .setWrapText(true)
  );

  if (analysis.crmAccount) {
    var acct = analysis.crmAccount;
    senderSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Zoho CRM Account')
        .setText(acct.Account_Name || acct.name || 'Found')
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open in Zoho')
            .setOpenLink(
              CardService.newOpenLink()
                .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/Accounts/' + acct.id)
            )
        )
    );

    if (acct.recentDeals && acct.recentDeals.length > 0) {
      var dealText = acct.recentDeals.map(function(d) {
        return (d.Deal_Name || 'Unnamed') + ' - ' + (d.Stage || 'unknown');
      }).join('\n');
      senderSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Recent Deals')
          .setText(dealText)
          .setWrapText(true)
      );
    }
  }

  card.addSection(senderSection);

  // ââ Detected Products ââ
  if (analysis.detectedSkus && analysis.detectedSkus.length > 0) {
    var skuSection = CardService.newCardSection()
      .setHeader('Detected Products');

    var skuList = analysis.detectedSkus.map(function(s) {
      return (s.qty > 1 ? s.qty + 'x ' : '') + s.sku;
    }).join(', ');

    skuSection.addWidget(
      CardService.newDecoratedText()
        .setText(skuList)
        .setWrapText(true)
    );

    skuSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Generate Quote from SKUs')
          .setOnClickAction(CardService.newAction().setFunctionName('onDetectSkus'))
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
    );

    card.addSection(skuSection);
  }

  addBackToEmailButton_(card);

  // ââ Send to Stratus AI (GChat DM handoff) ââ
  var handoffSection2 = CardService.newCardSection()
    .setHeader('Send to Stratus AI');

  handoffSection2.addWidget(
    CardService.newTextInput()
      .setFieldName('stratus_request')
      .setTitle('Your request')
      .setHint('e.g. "Look up this account in Zoho" or "Create a follow-up task"')
      .setMultiline(true)
  );

  handoffSection2.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Send to Stratus AI \u2192 GChat')
        .setOnClickAction(CardService.newAction().setFunctionName('onSendToStratusAI'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  handoffSection2.addWidget(
    CardService.newTextParagraph()
      .setText('Your request will be processed and delivered as a Google Chat message from Stratus AI. Conversation continues in GChat.')
  );

  card.addSection(handoffSection2);

  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// TASK CARD (open tasks for account)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildTaskCard_(result, emailCtx) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Open Tasks')
        .setSubtitle(truncate_(emailCtx.subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">' + result.error + '</font>')
      )
    );
    addBackToEmailButton_(card);
    return card.build();
  }

  var tasks = result.tasks || [];

  if (tasks.length === 0) {
    var emptySection = CardService.newCardSection();
    if (result.accounts && result.accounts.length > 0) {
      emptySection.addWidget(
        CardService.newTextParagraph().setText(
          'No open tasks found for:\n<i>' + result.accounts.map(function(a) { return a.name; }).join(', ') + '</i>'
        )
      );
    } else {
      emptySection.addWidget(
        CardService.newTextParagraph().setText(
          'No matching accounts found in Zoho CRM for this email thread.'
        )
      );
    }

    // Suggest Task button: let the preview endpoint determine account from sender email
    // Do NOT pre-fill account_id from task card results (could be Chris's own company from thread context)
    var threadDomains = (emailCtx.allDomains || []).join(',');
    var suggestParams = {
      sender_email: emailCtx.senderEmail || '',
      sender_name: emailCtx.senderName || '',
      subject: emailCtx.subject || '',
      has_account: 'false',
      account_id: '',
      thread_domains: threadDomains
    };

    emptySection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Create Follow-Up Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onSuggestTask')
              .setParameters(suggestParams)
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
    );

    card.addSection(emptySection);
    addBackToEmailButton_(card);
    return card.build();
  }

  // Show account info
  if (result.accounts && result.accounts.length > 0) {
    var acctSection = CardService.newCardSection();
    acctSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Accounts Found')
        .setText(result.accounts.map(function(a) { return a.name; }).join(', '))
        .setWrapText(true)
    );
    acctSection.addWidget(
      CardService.newTextParagraph().setText(
        '<b>' + tasks.length + '</b> open task' + (tasks.length !== 1 ? 's' : '')
      )
    );
    card.addSection(acctSection);
  }

  // Show each task (max 10 to avoid card size limits)
  var maxTasks = Math.min(tasks.length, 10);
  for (var i = 0; i < maxTasks; i++) {
    var task = tasks[i];
    var taskSection = CardService.newCardSection()
      .setHeader('Task ' + (i + 1));

    // Subject and due date
    var dueDateLabel = task.dueDate ? task.dueDate : 'No due date';
    var isOverdue = task.dueDate && new Date(task.dueDate + 'T23:59:59') < new Date();
    var dueText = isOverdue ? 'OVERDUE: ' + dueDateLabel : dueDateLabel;

    taskSection.addWidget(
      CardService.newDecoratedText()
        .setText(task.subject)
        .setBottomLabel('Due: ' + dueText + ' | Status: ' + task.status)
        .setWrapText(true)
    );

    // Deal/Contact info
    if (task.dealName) {
      taskSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Deal')
          .setText(task.dealName)
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/Deals/' + task.dealId)
              )
          )
      );
    }

    if (task.contactName) {
      taskSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Contact')
          .setText(task.contactName)
          .setWrapText(true)
      );
    }

    // Action buttons
    var taskParams = {
      task_id: task.id,
      deal_id: task.dealId || '',
      contact_id: task.contactId || '',
      task_subject: task.subject || '',
    };

    var btnSet = CardService.newButtonSet();

    btnSet.addButton(
      CardService.newTextButton()
        .setText('Complete + Follow Up')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onTaskComplete')
            .setParameters(taskParams)
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    );

    btnSet.addButton(
      CardService.newTextButton()
        .setText('Reschedule +3d')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onTaskReschedule')
            .setParameters(taskParams)
        )
    );

    taskSection.addWidget(btnSet);

    // Edit fields (collapsible via section)
    taskSection.addWidget(
      CardService.newTextInput()
        .setFieldName('edit_subject')
        .setTitle('New subject (optional)')
        .setHint(task.subject)
    );

    taskSection.addWidget(
      CardService.newTextInput()
        .setFieldName('edit_date')
        .setTitle('New date (YYYY-MM-DD)')
        .setHint(task.dueDate || 'YYYY-MM-DD')
    );

    taskSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Edit Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onTaskEdit')
              .setParameters(taskParams)
          )
      )
    );

    // Open in Zoho
    taskSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Open in Zoho')
          .setOpenLink(
            CardService.newOpenLink()
              .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/Tasks/' + task.id)
          )
      )
    );

    card.addSection(taskSection);
  }

  if (tasks.length > maxTasks) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          '<i>' + (tasks.length - maxTasks) + ' more tasks not shown. Open Zoho to see all.</i>'
        )
      )
    );
  }

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// TASK RESULT CARD (success/error after action)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildTaskResultCard_(result) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Task Updated')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  if (result.error) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        '<font color="#cc0000">' + result.error + '</font>'
      )
    );
  } else if (result.action === 'complete_and_followup') {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'Task completed successfully!'
      )
    );
    if (result.newTaskId) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Follow-up Created')
          .setText(result.newSubject || 'Follow up: next steps')
          .setBottomLabel('Due: ' + (result.newDueDate || 'TBD'))
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/Tasks/' + result.newTaskId)
              )
          )
      );
    }
  } else if (result.action === 'reschedule') {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'Task rescheduled to <b>' + result.newDueDate + '</b>'
      )
    );
  } else if (result.action === 'edit') {
    section.addWidget(
      CardService.newTextParagraph().setText('Task updated successfully!')
    );
  } else if (result.action === 'suggest_task') {
    var msg = result.message || 'Task created.';
    section.addWidget(
      CardService.newTextParagraph().setText(msg)
    );
    if (result.taskId) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Follow-Up Task')
          .setText(result.newSubject || 'Follow up')
          .setBottomLabel('Due: ' + (result.newDueDate || 'TBD'))
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(
                CardService.newOpenLink()
                  .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/Tasks/' + result.taskId)
              )
          )
      );
    }
    if (result.leadCreated) {
      section.addWidget(
        CardService.newTextParagraph().setText(
          '<i>New lead created for ' + (result.accountName || 'unknown') + '</i>'
        )
      );
    }
    if (result.contactCreated) {
      section.addWidget(
        CardService.newTextParagraph().setText(
          '<i>New contact added to ' + (result.accountName || 'unknown') + '</i>'
        )
      );
    }
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText('Action completed.')
    );
  }

  card.addSection(section);

  // Refresh tasks button
  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Refresh Tasks')
        .setOnClickAction(CardService.newAction().setFunctionName('onViewTasks'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// SUGGEST TASK PREVIEW CARD (confirmation before creating)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildSuggestTaskPreviewCard_(preview, originalParams) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Create Follow-Up Task')
        .setSubtitle('Review before creating')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  // Show what was found
  if (preview.accountFound) {
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Account Found')
        .setText(preview.accountName || 'Unknown')
        .setWrapText(true)
    );

    if (preview.contactFound) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Contact')
          .setText(preview.contactName || preview.senderEmail)
          .setBottomLabel('Already in CRM')
          .setWrapText(true)
      );
    } else {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Contact Not Found')
          .setText(preview.senderName + ' <' + preview.senderEmail + '>')
          .setBottomLabel('Will be added to ' + (preview.accountName || 'account'))
          .setWrapText(true)
      );
    }
  } else if (preview.associationUncertain) {
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Account Unknown')
        .setText(preview.senderName + ' <' + preview.senderEmail + '>')
        .setBottomLabel('Generic email, no existing CRM contact found')
        .setWrapText(true)
    );
    section.addWidget(
      CardService.newTextParagraph().setText(
        'This person uses a generic email and is not in CRM yet. A standalone follow-up task will be created with no account or contact association. You can manually link them later in Zoho.'
      )
    );
  } else if (preview.isGenericEmail) {
    // Generic email but contact/account WAS found (existing CRM contact)
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Generic Email')
        .setText(preview.senderName + ' <' + preview.senderEmail + '>')
        .setBottomLabel('Standalone task (no account link)')
        .setWrapText(true)
    );
  } else {
    section.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('No Account Found')
        .setText(preview.senderName + ' <' + preview.senderEmail + '>')
        .setBottomLabel('A new lead will be created for ' + (preview.companyName || preview.domain || 'unknown'))
        .setWrapText(true)
    );
  }

  // Task preview
  section.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('Task')
      .setText('Follow up: ' + (originalParams.subject || 'next steps'))
      .setBottomLabel('Due: ' + (preview.suggestedDueDate || 'TBD'))
      .setWrapText(true)
  );

  card.addSection(section);

  // Confirm / Cancel buttons
  var confirmParams = {
    sender_email: originalParams.sender_email,
    sender_name: originalParams.sender_name,
    subject: originalParams.subject,
    has_account: preview.accountFound ? 'true' : 'false',
    account_id: preview.accountId || '',
    create_contact: (preview.accountFound && !preview.contactFound) ? 'true' : 'false'
  };

  var btnSection = CardService.newCardSection();
  btnSection.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText('Confirm')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onConfirmSuggestTask')
              .setParameters(confirmParams)
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
      .addButton(
        CardService.newTextButton()
          .setText('Cancel')
          .setOnClickAction(CardService.newAction().setFunctionName('onViewTasks'))
      )
  );

  card.addSection(btnSection);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// ADMIN DASHBOARD CARD
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildAdminCard_(data) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Admin Dashboard')
        .setSubtitle('API Usage & Stats')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // Monthly usage summary
  var usageSection = CardService.newCardSection()
    .setHeader('This Month');

  var totalCost = data.totalCostUsd || 0;
  var requestCount = data.requestCount || 0;
  var inputTokens = data.totalInputTokens || 0;
  var outputTokens = data.totalOutputTokens || 0;

  usageSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('Total API Cost')
      .setText('$' + totalCost.toFixed(4))
      .setWrapText(true)
  );

  usageSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('Requests')
      .setText(String(requestCount))
      .setBottomLabel(
        'Input: ' + formatTokens_(inputTokens) + ' | Output: ' + formatTokens_(outputTokens)
      )
      .setWrapText(true)
  );

  card.addSection(usageSection);

  // By source breakdown
  if (data.bySource) {
    var sourceSection = CardService.newCardSection()
      .setHeader('By Feature')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);

    var sources = Object.keys(data.bySource);
    sources.sort(function(a, b) {
      return (data.bySource[b].costUsd || 0) - (data.bySource[a].costUsd || 0);
    });

    for (var i = 0; i < sources.length; i++) {
      var src = sources[i];
      var s = data.bySource[src];
      sourceSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel(src)
          .setText(s.requests + ' req | $' + (s.costUsd || 0).toFixed(4))
          .setWrapText(true)
      );
    }

    card.addSection(sourceSection);
  }

  // Recent requests
  if (data.recentRequests && data.recentRequests.length > 0) {
    var recentSection = CardService.newCardSection()
      .setHeader('Recent Requests')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);

    var maxRecent = Math.min(data.recentRequests.length, 10);
    for (var j = 0; j < maxRecent; j++) {
      var req = data.recentRequests[j];
      var ts = req.timestamp ? new Date(req.timestamp).toLocaleString() : 'unknown';
      recentSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel(req.source || 'unknown')
          .setText('$' + (req.costUsd || 0).toFixed(6))
          .setBottomLabel(ts + ' | ' + (req.model || '').split('-').slice(0,2).join('-'))
          .setWrapText(true)
      );
    }

    card.addSection(recentSection);
  }

  // System info
  var sysSection = CardService.newCardSection()
    .setHeader('System')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  if (data.lastPriceRefresh) {
    sysSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Last Price Refresh')
        .setText(data.lastPriceRefresh || 'Unknown')
        .setWrapText(true)
    );
  }

  if (data.priceStats) {
    sysSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Live Prices')
        .setText(data.priceStats || 'Unknown')
        .setWrapText(true)
    );
  }

  sysSection.addWidget(
    CardService.newDecoratedText()
      .setTopLabel('Worker Version')
      .setText(data.workerVersion || 'Unknown')
      .setWrapText(true)
  );

  card.addSection(sysSection);

  // Refresh + Back
  var navSection = CardService.newCardSection();
  navSection.addWidget(
    CardService.newButtonSet()
      .addButton(
        CardService.newTextButton()
          .setText('Refresh')
          .setOnClickAction(CardService.newAction().setFunctionName('onViewAdmin'))
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
      .addButton(
        CardService.newTextButton()
          .setText('Home')
          .setOnClickAction(CardService.newAction().setFunctionName('onBackToHome'))
      )
  );

  card.addSection(navSection);
  return card.build();
}

function formatTokens_(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return String(count);
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// DRAFT REPLY FORM CARD (tone selector + instructions)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildDraftReplyFormCard_(ctx) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Draft Reply')
        .setSubtitle('Re: ' + truncate_(ctx.subject, 40))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection()
    .setHeader('Quick Tone');

  // Quick tone buttons
  var toneButtons = CardService.newButtonSet();
  var tones = ['warm', 'professional', 'brief'];
  tones.forEach(function(tone) {
    toneButtons.addButton(
      CardService.newTextButton()
        .setText(capitalize_(tone))
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onDraftReply')
            .setParameters({ tone: tone })
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(tone === 'warm' ? CONFIG.STRATUS_BLUE : CONFIG.STRATUS_DARK)
    );
  });
  section.addWidget(toneButtons);

  card.addSection(section);

  // Custom instructions
  var customSection = CardService.newCardSection()
    .setHeader('Custom Draft');

  customSection.addWidget(
    CardService.newTextInput()
      .setFieldName('reply_instructions')
      .setTitle('Instructions')
      .setHint('e.g. "Include a 3-year renewal quote"')
      .setMultiline(true)
  );

  customSection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('reply_tone')
      .setTitle('Tone')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Warm', 'warm', true)
      .addItem('Professional', 'professional', false)
      .addItem('Brief', 'brief', false)
  );

  customSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Generate Draft')
        .setOnClickAction(CardService.newAction().setFunctionName('onDraftReplyCustom'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(customSection);

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// DRAFT REPLY CARD (generated drafts)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildDraftReplyCard_(result, emailCtx) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Draft Reply')
        .setSubtitle('Re: ' + truncate_(emailCtx.subject, 40))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">' + result.error + '</font>')
      )
    );
    addBackToEmailButton_(card);
    return card.build();
  }

  var drafts = result.drafts || [result.draft || result.reply || ''];
  drafts.forEach(function(draft, idx) {
    var section = CardService.newCardSection()
      .setHeader('Option ' + (idx + 1));

    section.addWidget(
      CardService.newTextParagraph().setText(draft)
    );

    var buttons = CardService.newButtonSet();
    buttons.addButton(
      CardService.newTextButton()
        .setText('Create Gmail Draft')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onInsertDraft')
            .setParameters({ draft_body: draft })
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    );
    section.addWidget(buttons);

    card.addSection(section);
  });

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// QUOTE RESULT CARD
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildQuoteResultCard_(result) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Quote Generated')
        .setSubtitle('Stratus URL Quote')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">' + result.error + '</font>')
      )
    );
    addBackToEmailButton_(card);
    return card.build();
  }

  // Quote URLs
  if (result.quoteUrls && result.quoteUrls.length > 0) {
    var urlSection = CardService.newCardSection()
      .setHeader('Quote Links');

    result.quoteUrls.forEach(function(q) {
      urlSection.addWidget(
        CardService.newDecoratedText()
          .setText(q.label || q.term || 'Quote')
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(CardService.newOpenLink().setUrl(q.url))
          )
      );
    });

    card.addSection(urlSection);
  }

  // Full response text
  if (result.responseText) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('Details')
        .setCollapsible(true)
        .setNumUncollapsibleWidgets(1)
        .addWidget(
          CardService.newTextParagraph().setText(truncate_(result.responseText, 2000))
        )
    );
  }

  // EOL warnings
  if (result.eolWarnings && result.eolWarnings.length > 0) {
    var eolSection = CardService.newCardSection()
      .setHeader('EOL Warnings');
    result.eolWarnings.forEach(function(w) {
      eolSection.addWidget(
        CardService.newDecoratedText()
          .setText(w)
          .setWrapText(true)
      );
    });
    card.addSection(eolSection);
  }

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// CRM RESULT CARD
// âââââââââââââââââââââââââââââââââââââââââââââ


// ADD CONTACT CARD (form)

function buildAddContactCard_(firstName, lastName, email, phone, title, accountId, accountName) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Add Contact to Zoho CRM')
        .setSubtitle(accountName ? 'Account: ' + accountName : 'No account linked')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  section.addWidget(CardService.newTextInput()
    .setFieldName('contact_first_name')
    .setTitle('First Name')
    .setValue(firstName || ''));

  section.addWidget(CardService.newTextInput()
    .setFieldName('contact_last_name')
    .setTitle('Last Name *')
    .setValue(lastName || ''));

  section.addWidget(CardService.newTextInput()
    .setFieldName('contact_email')
    .setTitle('Email *')
    .setValue(email || ''));

  section.addWidget(CardService.newTextInput()
    .setFieldName('contact_phone')
    .setTitle('Phone')
    .setValue(phone || ''));

  section.addWidget(CardService.newTextInput()
    .setFieldName('contact_title')
    .setTitle('Title / Role')
    .setValue(title || ''));

  if (accountName) {
    section.addWidget(CardService.newDecoratedText()
      .setText('Linked to: <b>' + accountName + '</b>')
      .setWrapText(true));
  }

  var submitAction = CardService.newAction()
    .setFunctionName('onAddContact')
    .setParameters({ account_id: accountId || '' });

  section.addWidget(CardService.newTextButton()
    .setText('Create Contact')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setBackgroundColor(CONFIG.STRATUS_BLUE)
    .setOnClickAction(submitAction));

  section.addWidget(CardService.newTextButton()
    .setText('< Back')
    .setOnClickAction(CardService.newAction().setFunctionName('onBackToEmail')));

  card.addSection(section);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

// CONTACT CREATED CARD (result)

function buildContactCreatedCard_(result, isDuplicate) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle(isDuplicate ? 'Contact Already Exists' : 'Contact Created')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  if (isDuplicate) {
    var existing = result.existingContact || {};
    section.addWidget(CardService.newDecoratedText()
      .setText('<b>' + (existing.name || 'Unknown') + '</b>')
      .setBottomLabel(existing.email || '')
      .setWrapText(true));
    if (existing.zohoUrl) {
      section.addWidget(CardService.newTextButton()
        .setText('Open in Zoho')
        .setOpenLink(CardService.newOpenLink().setUrl(existing.zohoUrl)));
    }
  } else {
    section.addWidget(CardService.newDecoratedText()
      .setText(result.message || 'Contact created successfully')
      .setWrapText(true));
    if (result.zohoUrl) {
      section.addWidget(CardService.newTextButton()
        .setText('Open in Zoho')
        .setOpenLink(CardService.newOpenLink().setUrl(result.zohoUrl)));
    }
  }

  section.addWidget(CardService.newTextButton()
    .setText('< Back')
    .setOnClickAction(CardService.newAction().setFunctionName('onBackToEmail')));

  card.addSection(section);
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function buildCrmResultCard_(result, query, module) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('CRM Results')
        .setSubtitle(module + ': "' + truncate_(query, 30) + '"')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">' + result.error + '</font>')
      )
    );
    addBackToEmailButton_(card);
    return card.build();
  }

  var records = result.records || [];
  if (records.length === 0) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No results for "' + query + '" in ' + module + '.')
      )
    );
    addBackToEmailButton_(card);
    return card.build();
  }

  records.forEach(function(rec) {
    var section = CardService.newCardSection();

    var displayName = rec.Account_Name || rec.Deal_Name ||
      ((rec.First_Name || '') + ' ' + (rec.Last_Name || '')).trim() ||
      rec.Quote_Number || rec.Subject || rec.name || 'Record';

    var bottomLabel = rec.Email || rec.Phone || '';
    if (rec.Stage) bottomLabel = (bottomLabel ? bottomLabel + ' | ' : '') + rec.Stage;

    section.addWidget(
      CardService.newDecoratedText()
        .setText(displayName)
        .setBottomLabel(bottomLabel)
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open in Zoho')
            .setOpenLink(
              CardService.newOpenLink()
                .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/' + module + '/' + rec.id)
            )
        )
    );

    if (rec.Amount) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Amount')
          .setText('$' + Number(rec.Amount).toLocaleString())
      );
    }

    card.addSection(section);
  });

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// QUOTE BUILDER CARD (compose trigger + prefill)
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildQuoteBuilderCard_(prefill) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus Quote Builder')
        .setSubtitle('Generate a URL quote')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  section.addWidget(
    CardService.newTextInput()
      .setFieldName('sku_input')
      .setTitle('SKUs')
      .setHint('e.g. 10 MR44, 5 MS130-24P, 2 MX67')
      .setMultiline(true)
      .setValue(prefill || '')
  );

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Generate Quote')
        .setOnClickAction(CardService.newAction().setFunctionName('onGenerateQuote'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(section);
  return card.build();
}
// TASK EDIT CARD
// ===============================================

function buildTaskEditCard_(params) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Edit Task')
        .setSubtitle(params.task_subject || '')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  // Editable subject
  section.addWidget(
    CardService.newTextInput()
      .setFieldName('edit_subject')
      .setTitle('Subject')
      .setValue(params.task_subject || '')
      .setMultiline(false)
  );

  // DatePicker for due date
  var currentDueMs = null;
  if (params.task_due_date) {
    var parts = params.task_due_date.split('-');
    if (parts.length === 3) {
      currentDueMs = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])).getTime();
    }
  }
  if (!currentDueMs) {
    currentDueMs = addBusinessDays_(new Date(), 3).getTime();
  }

  section.addWidget(
    CardService.newDatePicker()
      .setFieldName('edit_due_date')
      .setTitle('Due Date')
      .setValueInMsSinceEpoch(currentDueMs)
  );

  // Save button
  var saveParams = {
    task_id: params.task_id || '',
    deal_id: params.deal_id || '',
    contact_id: params.contact_id || '',
  };

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Save Changes')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onTaskEdit')
            .setParameters(saveParams)
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(section);
  addBackToEmailButton_(card);
  return card.build();
}


// REPLY DETECTED CARD
// ═══════════════════════════════════════════

function buildReplyDetectedCard_(result) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Reply Detected')
        .setSubtitle(result.newCount + ' new message(s) in thread')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection()
    .setHeader('You replied to this thread');

  section.addWidget(
    CardService.newTextParagraph().setText(
      '<b>Subject:</b> ' + (result.subject || '(no subject)') + '\n' +
      '<b>Customer:</b> ' + (result.customerName || result.customerEmail || 'Unknown')
    )
  );

  if (result.stratusReplies && result.stratusReplies.length > 0) {
    var reply = result.stratusReplies[result.stratusReplies.length - 1];
    section.addWidget(
      CardService.newTextParagraph().setText(
        '<i>"' + (reply.snippet || '').substring(0, 80) + '..."</i>'
      )
    );
  }

  section.addWidget(
    CardService.newTextParagraph().setText(
      '\nWould you like to create a follow-up task?'
    )
  );

  var baseParams = {
    customer_email: result.customerEmail || '',
    customer_name: result.customerName || '',
    subject: result.subject || '',
  };

  // Option 1: Create new follow-up task (3 business days)
  var createParams = {};
  for (var k in baseParams) createParams[k] = baseParams[k];
  createParams.followup_action = 'create';

  var buttons = CardService.newButtonSet();
  buttons.addButton(
    CardService.newTextButton()
      .setText('Create Follow-up (3 days)')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onCreateReplyFollowup')
          .setParameters(createParams)
      )
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor(CONFIG.STRATUS_BLUE)
  );

  // If there's an existing open task, offer to extend it instead
  if (result.existingTask && result.existingTask.id) {
    var extendParams = {};
    for (var ek in baseParams) extendParams[ek] = baseParams[ek];
    extendParams.followup_action = 'extend';
    extendParams.existing_task_id = result.existingTask.id;

    buttons.addButton(
      CardService.newTextButton()
        .setText('Extend Task +3 days')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onCreateReplyFollowup')
            .setParameters(extendParams)
        )
    );

    section.addWidget(
      CardService.newTextParagraph().setText(
        '<i>Existing task: ' + (result.existingTask.subject || '') +
        ' (due ' + (result.existingTask.dueDate || 'N/A') + ')</i>'
      )
    );
  }

  section.addWidget(buttons);

  // Dismiss option
  section.addWidget(
    CardService.newTextButton()
      .setText('Dismiss')
      .setOnClickAction(
        CardService.newAction().setFunctionName('onBackToEmail')
      )
  );

  card.addSection(section);
  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// ERROR CARD
// âââââââââââââââââââââââââââââââââââââââââââââ


// CRM NOT FOUND CARD
// -------------------------------------------------

function buildCrmNotFoundCard_(email, displayName) {
  var label = displayName ? displayName + ' (' + email + ')' : email;
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Not in CRM')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<i>No CRM record found for ' + label + '</i>')
      ).addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText('Add Contact to Zoho')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onShowAddContact')
                .setParameters({ prefill_email: email, prefill_name: displayName || '' })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor(CONFIG.STRATUS_DARK)
        )
      )
    );

  addBackToEmailButton_(card);
  return card.build();
}

function buildErrorCard_(message) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Error')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<font color="#cc0000">' + message + '</font>')
      )
    );

  addBackToEmailButton_(card);
  return card.build();
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// SHARED HELPERS
// âââââââââââââââââââââââââââââââââââââââââââââ

function addBackToEmailButton_(card) {
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText('Back to Email')
            .setOnClickAction(CardService.newAction().setFunctionName('onBackToEmail'))
        )
        .addButton(
          CardService.newTextButton()
            .setText('Home')
            .setOnClickAction(CardService.newAction().setFunctionName('onBackToHome'))
        )
    )
  );
}

function addBackButton_(card) {
  addBackToEmailButton_(card);
}

// âââââââââââââââââââââââââââââââââââââââââââââ
// STRATUS AI HANDOFF CONFIRMATION CARD
// âââââââââââââââââââââââââââââââââââââââââââââ

function buildStratusHandoffCard_(result) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Request Sent')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  if (result && result.ok) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'â Your request has been sent! Stratus AI will reply to you via Google Chat DM shortly.'
      )
    );
    if (result.message) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Status')
          .setText(result.message)
          .setWrapText(true)
      );
    }
  } else {
    section.addWidget(
      CardService.newTextParagraph().setText(
        'â Failed to send request. ' + ((result && result.error) || 'Please try again.')
      )
    );
  }

  card.addSection(section);
  addBackToEmailButton_(card);
  return card.build();
}

// ═══════════════════════════════════════════════════════════════
// CRM SIDEBAR CARDS — Replaces Zoho for Gmail Chrome Extension
// Zero AI cost — direct Zoho REST API calls
// ═══════════════════════════════════════════════════════════════

/**
 * CRM Contact Details card with tabbed navigation (Info, Deals, Activities, Quotes)
 * This is the main CRM sidebar entry point.
 */
function buildCrmSidebarCard_(contactData, activeTab) {
  var contact = contactData.contact;
  var account = contactData.account;
  var tab = activeTab || 'info';

  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle(contact ? contact.fullName : (account ? account.name : 'CRM Lookup'))
        .setSubtitle(contact ? (contact.title || contact.email) : (account ? account.website : ''))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ── Tab Navigation ──
  var tabSection = CardService.newCardSection();
  var tabParams = {
    contact_id: contact ? contact.id : '',
    account_id: account ? account.id : '',
    contact_email: contact ? contact.email : '',
  };

  var tabs = CardService.newButtonSet();
  var tabNames = ['Info', 'Deals', 'Tasks'];
  var tabKeys = ['info', 'deals', 'tasks'];

  for (var i = 0; i < tabNames.length; i++) {
    var params = {};
    for (var key in tabParams) params[key] = tabParams[key];
    params.tab = tabKeys[i];

    var btn = CardService.newTextButton()
      .setText(tabKeys[i] === tab ? '\u25cf ' + tabNames[i] : tabNames[i])
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onCrmTab')
          .setParameters(params)
      );

    if (tabKeys[i] === tab) {
      btn.setTextButtonStyle(CardService.TextButtonStyle.FILLED)
         .setBackgroundColor(CONFIG.STRATUS_BLUE);
    }
    tabs.addButton(btn);
  }
  tabSection.addWidget(tabs);
  card.addSection(tabSection);

  // ── Tab Content is loaded by the action handler ──
  // This card just shows the nav; content is rendered by tab-specific functions

  return card;
}

/**
 * Info tab: Contact details + Account details
 */
function buildCrmInfoTab_(card, contact, account) {
  // Contact Info
  if (contact) {
    var contactSection = CardService.newCardSection().setHeader('Contact');

    contactSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Name')
        .setText(contact.fullName || 'Unknown')
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(CardService.newOpenLink().setUrl(contact.zohoUrl))
        )
    );

    if (contact.email) {
      contactSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Email')
          .setText(contact.email)
          .setWrapText(true)
      );
    }

    if (contact.phone) {
      contactSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Phone')
          .setText(contact.phone)
      );
    }

    if (contact.mobile && contact.mobile !== contact.phone) {
      contactSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Mobile')
          .setText(contact.mobile)
      );
    }

    if (contact.title) {
      contactSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Title')
          .setText(contact.title)
          .setWrapText(true)
      );
    }

    card.addSection(contactSection);
  }

  // Account Info
  if (account) {
    var acctSection = CardService.newCardSection().setHeader('Account');

    acctSection.addWidget(
      CardService.newDecoratedText()
        .setTopLabel('Account Name')
        .setText(account.name || 'Unknown')
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(CardService.newOpenLink().setUrl(account.zohoUrl))
        )
    );

    if (account.phone) {
      acctSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Phone')
          .setText(account.phone)
      );
    }

    if (account.website) {
      acctSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Website')
          .setText(account.website)
          .setWrapText(true)
      );
    }

    if (account.address) {
      acctSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Address')
          .setText(account.address)
          .setWrapText(true)
      );
    }

    if (account.industry) {
      acctSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Industry')
          .setText(account.industry)
      );
    }

    card.addSection(acctSection);
  }

  if (!contact && !account) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No contact or account found in Zoho CRM for this sender.')
      )
    );
  }

  // Add Note section
  if (contact || account) {
    var noteSection = CardService.newCardSection()
      .setHeader('Notes')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);

    noteSection.addWidget(
      CardService.newTextInput()
        .setFieldName('crm_note_content')
        .setTitle('Add a note')
        .setHint('Type a note to add to this contact/account')
        .setMultiline(true)
    );

    var noteParams = {
      parent_module: contact ? 'Contacts' : 'Accounts',
      parent_id: contact ? contact.id : account.id,
    };

    noteSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Add Note')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmAddNote')
              .setParameters(noteParams)
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_DARK)
      )
    );

    card.addSection(noteSection);
  }
}

/**
 * Deals tab: Show all deals for the account
 */
function buildCrmDealsTab_(card, dealsResult) {
  var deals = (dealsResult && dealsResult.deals) || [];

  if (deals.length === 0) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No deals found for this account.')
      )
    );
    return;
  }

  for (var i = 0; i < Math.min(deals.length, 10); i++) {
    var deal = deals[i];
    var section = CardService.newCardSection();

    var stageColor = '';
    if (deal.stage === 'Closed Won') stageColor = '#0f9d58';
    else if (deal.stage === 'Closed (Lost)') stageColor = '#cc0000';
    else stageColor = '#1a73a7';

    section.addWidget(
      CardService.newDecoratedText()
        .setText(deal.name)
        .setBottomLabel(deal.stage + (deal.closingDate ? ' | ' + deal.closingDate : ''))
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(CardService.newOpenLink().setUrl(deal.zohoUrl))
        )
    );

    var detailParts = [];
    if (deal.amount) detailParts.push('$' + Number(deal.amount).toLocaleString());
    if (deal.probability) detailParts.push(deal.probability + '%');
    if (deal.contactName) detailParts.push(deal.contactName);

    if (detailParts.length > 0) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Amount / Probability / Contact')
          .setText(detailParts.join('  |  '))
          .setWrapText(true)
      );
    }

    card.addSection(section);
  }

  if (deals.length > 10) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('<i>' + (deals.length - 10) + ' more deals not shown.</i>')
      )
    );
  }
}

/**
 * Tasks tab: Open tasks with action buttons + recently completed
 */
function buildCrmTasksTab_(card, activitiesResult, tabParams) {
  var tasks = (activitiesResult && activitiesResult.tasks) || [];
  var recentCompleted = (activitiesResult && activitiesResult.recentCompleted) || [];

  if (tasks.length === 0 && recentCompleted.length === 0) {
    var emptySection = CardService.newCardSection();
    emptySection.addWidget(
      CardService.newTextParagraph().setText('No open tasks found.')
    );

    // Create task button
    var createParams = {
      contact_id: tabParams.contact_id || '',
      account_id: tabParams.account_id || '',
    };
    emptySection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Create Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmShowCreateTask')
              .setParameters(createParams)
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
    );
    card.addSection(emptySection);
    return;
  }

  // Open tasks
  if (tasks.length > 0) {
    var openHeader = CardService.newCardSection()
      .setHeader('Open Tasks (' + tasks.length + ')');

    // Create task button at top
    openHeader.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('+ New Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmShowCreateTask')
              .setParameters({ contact_id: tabParams.contact_id || '', account_id: tabParams.account_id || '' })
          )
      )
    );
    card.addSection(openHeader);

    for (var i = 0; i < Math.min(tasks.length, 8); i++) {
      var task = tasks[i];
      var taskSection = CardService.newCardSection();

      var isOverdue = task.dueDate && new Date(task.dueDate + 'T23:59:59') < new Date();
      var dueLabel = task.dueDate ? (isOverdue ? 'OVERDUE: ' : '') + task.dueDate : 'No due date';

      taskSection.addWidget(
        CardService.newDecoratedText()
          .setText(task.subject)
          .setBottomLabel('Due: ' + dueLabel + ' | ' + task.status + (task.priority !== 'Normal' ? ' | ' + task.priority : ''))
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(CardService.newOpenLink().setUrl(task.zohoUrl))
          )
      );

      if (task.dealName) {
        taskSection.addWidget(
          CardService.newDecoratedText()
            .setTopLabel('Deal')
            .setText(task.dealName)
            .setWrapText(true)
        );
      }

      // Action buttons
      var taskActionParams = {
        task_id: task.id,
        deal_id: task.dealId || '',
        contact_id: task.contactId || '',
        task_subject: task.subject || '',
        task_due_date: task.dueDate || '',
      };

      var actionBtns = CardService.newButtonSet();
      actionBtns.addButton(
        CardService.newTextButton()
          .setText('Complete + Follow Up')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onTaskComplete')
              .setParameters(taskActionParams)
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      );
      actionBtns.addButton(
        CardService.newTextButton()
          .setText('Close Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onTaskCloseOnly')
              .setParameters(taskActionParams)
          )
      );
      taskSection.addWidget(actionBtns);

      var editBtn = CardService.newButtonSet();
      editBtn.addButton(
        CardService.newTextButton()
          .setText('Edit')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onTaskShowEdit')
              .setParameters(taskActionParams)
          )
      );
      taskSection.addWidget(editBtn);

      card.addSection(taskSection);
    }
  }

  // Create Task button when no open tasks but completed tasks exist
  if (tasks.length === 0 && recentCompleted.length > 0) {
    var noOpenSection = CardService.newCardSection()
      .setHeader('Open Tasks (0)');
    noOpenSection.addWidget(
      CardService.newTextParagraph().setText('No open tasks.')
    );
    noOpenSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('+ Create Task')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmShowCreateTask')
              .setParameters({ contact_id: tabParams.contact_id || '', account_id: tabParams.account_id || '' })
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_BLUE)
      )
    );
    card.addSection(noOpenSection);
  }

  // Recently completed
  if (recentCompleted.length > 0) {
    var compSection = CardService.newCardSection()
      .setHeader('Recently Completed')
      .setCollapsible(true)
      .setNumUncollapsibleWidgets(0);

    for (var j = 0; j < recentCompleted.length; j++) {
      var comp = recentCompleted[j];
      compSection.addWidget(
        CardService.newDecoratedText()
          .setText(comp.subject)
          .setBottomLabel('Completed: ' + comp.completedDate)
          .setWrapText(true)
      );
    }
    card.addSection(compSection);
  }
}

/**
 * Quotes tab: Show quotes for the account
 */
function buildCrmQuotesTab_(card, quotesResult) {
  var quotes = (quotesResult && quotesResult.quotes) || [];

  if (quotes.length === 0) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No quotes found for this account.')
      )
    );
    return;
  }

  for (var i = 0; i < Math.min(quotes.length, 10); i++) {
    var q = quotes[i];
    var section = CardService.newCardSection();

    var qTitle = q.subject || ('Quote #' + q.quoteNumber);
    var qDetail = [];
    if (q.grandTotal) qDetail.push('$' + Number(q.grandTotal).toLocaleString());
    if (q.stage) qDetail.push(q.stage);
    if (q.createdTime) qDetail.push(q.createdTime);

    section.addWidget(
      CardService.newDecoratedText()
        .setText(qTitle)
        .setBottomLabel(qDetail.join(' | '))
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(CardService.newOpenLink().setUrl(q.zohoUrl))
        )
    );

    if (q.dealName) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Deal')
          .setText(q.dealName)
          .setWrapText(true)
      );
    }

    card.addSection(section);
  }
}

/**
 * Create Task form card
 */
function buildCrmCreateTaskCard_(params) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Create Task')
        .setSubtitle('New Zoho CRM Task')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  var section = CardService.newCardSection();

  section.addWidget(
    CardService.newTextInput()
      .setFieldName('new_task_subject')
      .setTitle('Subject')
      .setHint('e.g. Follow up on quote')
  );

  // Default to 3 business days from now
  var defaultDue = addBusinessDays_(new Date(), 3);
  var defaultMs = defaultDue.getTime();

  section.addWidget(
    CardService.newDatePicker()
      .setFieldName('new_task_due')
      .setTitle('Due Date')
      .setValueInMsSinceEpoch(defaultMs)
  );

  // Deal dropdown (populated from account deals)
  var dealDropdown = CardService.newSelectionInput()
    .setFieldName('new_task_deal')
    .setTitle('Associate with Deal')
    .setType(CardService.SelectionInputType.DROPDOWN)
    .addItem('Auto-select most recent', '', true);

  var accountId = params.account_id || '';
  if (accountId) {
    try {
      var dealsForDropdown = crmDeals_(accountId, '');
      if (dealsForDropdown && dealsForDropdown.deals) {
        for (var di = 0; di < Math.min(dealsForDropdown.deals.length, 15); di++) {
          var dd = dealsForDropdown.deals[di];
          dealDropdown.addItem(
            truncate_(dd.name, 40) + ' (' + (dd.stage || 'N/A') + ')',
            dd.id,
            false
          );
        }
      }
    } catch (_) { /* proceed without deals list */ }
  }
  section.addWidget(dealDropdown);

  section.addWidget(
    CardService.newSelectionInput()
      .setFieldName('new_task_priority')
      .setTitle('Priority')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Normal', 'Normal', true)
      .addItem('High', 'High', false)
      .addItem('Highest', 'Highest', false)
      .addItem('Low', 'Low', false)
      .addItem('Lowest', 'Lowest', false)
  );

  section.addWidget(
    CardService.newTextInput()
      .setFieldName('new_task_description')
      .setTitle('Description (optional)')
      .setMultiline(true)
  );

  var createParams = {
    contact_id: params.contact_id || '',
    account_id: params.account_id || '',
  };

  section.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Create Task')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onCrmCreateTask')
            .setParameters(createParams)
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(section);
  addBackToEmailButton_(card);
  return card.build();
}
