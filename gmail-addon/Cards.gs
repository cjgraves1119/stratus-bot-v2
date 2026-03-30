/**
 * Stratus AI Gmail Add-on — Card Builders (v3 lazy-load + tasks)
 *
 * Instant sidebar on email open. AI features triggered by buttons.
 * Task automation with complete/reschedule/edit actions.
 */

// ─────────────────────────────────────────────
// HOMEPAGE CARD (no email context)
// ─────────────────────────────────────────────

function buildHomepageCard_() {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Cisco/Meraki Sales Assistant')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ── Quick Quote ──
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

  // ── CRM Search ──
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

  // ── Info / Help ──
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

  // ── Admin ──
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

// ─────────────────────────────────────────────
// INSTANT EMAIL CARD (no API call — loads instantly)
// ─────────────────────────────────────────────

function buildInstantEmailCard_(subject, sender) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle(truncate_(subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ── Sender Info ──
  var senderSection = CardService.newCardSection()
    .setHeader('Sender');

  senderSection.addWidget(
    CardService.newDecoratedText()
      .setText(sender.name)
      .setBottomLabel(sender.email)
      .setWrapText(true)
  );

  card.addSection(senderSection);

  // ── Quick Quote (always available, no API needed) ──
  var quoteSection = CardService.newCardSection()
    .setHeader('Quick Quote');

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

  // ── AI Actions (each triggers its own API call) ──
  var actionsSection = CardService.newCardSection()
    .setHeader('AI Tools');

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
      .setText('View Tasks')
      .setOnClickAction(CardService.newAction().setFunctionName('onViewTasks'))
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setBackgroundColor(CONFIG.STRATUS_DARK)
  );
  actionsSection.addWidget(actionButtons1);

  var actionButtons2 = CardService.newButtonSet();
  actionButtons2.addButton(
    CardService.newTextButton()
      .setText('Draft Reply')
      .setOnClickAction(CardService.newAction().setFunctionName('onShowDraftReply'))
  );
  actionButtons2.addButton(
    CardService.newTextButton()
      .setText('Detect SKUs')
      .setOnClickAction(CardService.newAction().setFunctionName('onDetectSkus'))
  );
  actionsSection.addWidget(actionButtons2);

  // CRM search buttons
  var domain = sender.email.split('@')[1] || sender.email;
  var crmButtons = CardService.newButtonSet();
  crmButtons.addButton(
    CardService.newTextButton()
      .setText('Search CRM')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onCrmLookup')
          .setParameters({ query: domain, module: 'Accounts' })
      )
  );
  actionsSection.addWidget(crmButtons);

  card.addSection(actionsSection);

  // ── Send to Stratus AI (GChat DM handoff) ──
  var handoffSection = CardService.newCardSection()
    .setHeader('Send to Stratus AI');

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
        .setText('Send to Stratus AI → GChat')
        .setOnClickAction(CardService.newAction().setFunctionName('onSendToStratusAI'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(handoffSection);

  return card.build();
}

// ─────────────────────────────────────────────
// EMAIL ANALYSIS CARD (AI analysis succeeded)
// ─────────────────────────────────────────────

function buildEmailAnalysisCard_(subject, sender, analysis) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('AI Analysis')
        .setSubtitle(truncate_(subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ── AI Summary ──
  if (analysis.summary) {
    var summarySection = CardService.newCardSection()
      .setHeader('Summary');

    if (analysis.urgency) {
      var urgencyIcon = analysis.urgency === 'high' ? '🔴' :
                        analysis.urgency === 'medium' ? '🟡' : '🟢';
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

  // ── Sender & CRM ──
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

  // ── Detected Products ──
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

  // ── Send to Stratus AI (GChat DM handoff) ──
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

// ─────────────────────────────────────────────
// TASK CARD (open tasks for account)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// TASK RESULT CARD (success/error after action)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// SUGGEST TASK PREVIEW CARD (confirmation before creating)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// ADMIN DASHBOARD CARD
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// DRAFT REPLY FORM CARD (tone selector + instructions)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// DRAFT REPLY CARD (generated drafts)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// QUOTE RESULT CARD
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// CRM RESULT CARD
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// QUOTE BUILDER CARD (compose trigger + prefill)
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// ERROR CARD
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// STRATUS AI HANDOFF CONFIRMATION CARD
// ─────────────────────────────────────────────

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
        '✅ Your request has been sent! Stratus AI will reply to you via Google Chat DM shortly.'
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
        '❌ Failed to send request. ' + ((result && result.error) || 'Please try again.')
      )
    );
  }

  card.addSection(section);
  addBackToEmailButton_(card);
  return card.build();
}
