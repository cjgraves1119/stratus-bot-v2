/**
 * Stratus AI Gmail Add-on — Card Builders (v2 redesign)
 *
 * Full-featured sidebar with collapsible sections, all tools accessible
 * from both homepage and email contexts.
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

  // ── Info / Help ──
  var infoSection = CardService.newCardSection()
    .setHeader('Tips')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  infoSection.addWidget(
    CardService.newTextParagraph().setText(
      'Open any email to unlock AI features:\n' +
      '• <b>Email Analysis</b> — AI summary, urgency, action items\n' +
      '• <b>Draft Replies</b> — warm, professional, or brief tone\n' +
      '• <b>CRM Lookup</b> — auto-finds sender in Zoho\n' +
      '• <b>SKU Detection</b> — finds Cisco products in emails\n\n' +
      'Use <b>Insert Stratus Quote</b> in the compose menu to add quotes to outgoing emails.'
    )
  );

  card.addSection(infoSection);

  return card.build();
}

// ─────────────────────────────────────────────
// EMAIL ANALYSIS CARD (AI analysis succeeded)
// ─────────────────────────────────────────────

function buildEmailAnalysisCard_(subject, sender, analysis) {
  var card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle(truncate_(subject, 50))
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl(CONFIG.ICON_URL)
    );

  // ── AI Summary (always visible) ──
  if (analysis.summary) {
    var summarySection = CardService.newCardSection()
      .setHeader('AI Summary');

    // Urgency badge
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

    // Action items
    if (analysis.actionItems && analysis.actionItems.length > 0) {
      summarySection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Action Items')
          .setText(analysis.actionItems.map(function(item, i) {
            return '• ' + item;
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
        return (d.Deal_Name || 'Unnamed') + ' — ' + (d.Stage || 'unknown');
      }).join('\n');
      senderSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Recent Deals')
          .setText(dealText)
          .setWrapText(true)
      );
    }
  } else {
    // No CRM match — offer manual search
    var searchButtons = CardService.newButtonSet();
    searchButtons.addButton(
      CardService.newTextButton()
        .setText('Search Accounts')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onCrmLookup')
            .setParameters({ query: sender.email.split('@')[1] || sender.email, module: 'Accounts' })
        )
    );
    searchButtons.addButton(
      CardService.newTextButton()
        .setText('Search Contacts')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onCrmLookup')
            .setParameters({ query: sender.email, module: 'Contacts' })
        )
    );
    senderSection.addWidget(searchButtons);
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

  // ── Draft Reply ──
  var replySection = CardService.newCardSection()
    .setHeader('Draft Reply');

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
    );
  });
  replySection.addWidget(toneButtons);

  // Custom instructions
  replySection.addWidget(
    CardService.newTextInput()
      .setFieldName('reply_instructions')
      .setTitle('Custom instructions (optional)')
      .setHint('e.g. "Include a 3-year renewal quote"')
      .setMultiline(true)
  );

  replySection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('reply_tone')
      .setTitle('Tone')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Warm', 'warm', true)
      .addItem('Professional', 'professional', false)
      .addItem('Brief', 'brief', false)
  );

  replySection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Draft with Instructions')
        .setOnClickAction(CardService.newAction().setFunctionName('onDraftReplyCustom'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(replySection);

  // ── Quick Quote (collapsible) ──
  var quoteSection = CardService.newCardSection()
    .setHeader('Quick Quote')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

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

  return card.build();
}

// ─────────────────────────────────────────────
// EMAIL MANUAL CARD (API failed — still show all tools)
// ─────────────────────────────────────────────

function buildEmailManualCard_(subject, sender, errorMsg) {
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

  // CRM search buttons
  var crmButtons = CardService.newButtonSet();
  crmButtons.addButton(
    CardService.newTextButton()
      .setText('Search Accounts')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onCrmLookup')
          .setParameters({ query: sender.email.split('@')[1] || sender.email, module: 'Accounts' })
      )
  );
  crmButtons.addButton(
    CardService.newTextButton()
      .setText('Search Contacts')
      .setOnClickAction(
        CardService.newAction()
          .setFunctionName('onCrmLookup')
          .setParameters({ query: sender.email, module: 'Contacts' })
      )
  );
  senderSection.addWidget(crmButtons);

  card.addSection(senderSection);

  // ── AI Analysis retry button ──
  var aiSection = CardService.newCardSection()
    .setHeader('AI Analysis');

  aiSection.addWidget(
    CardService.newTextParagraph().setText(
      '<font color="#cc0000">AI analysis unavailable: ' + truncate_(errorMsg, 120) + '</font>'
    )
  );

  if (errorMsg && errorMsg.indexOf('script.external_request') > -1) {
    aiSection.addWidget(
      CardService.newTextParagraph().setText(
        '<b>Fix:</b> Open Apps Script editor, select the <b>authorize</b> function from the dropdown, click <b>Run</b>, and approve all permissions. Then uninstall and reinstall the test deployment.'
      )
    );
  }

  aiSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Retry Analysis')
        .setOnClickAction(CardService.newAction().setFunctionName('onAnalyzeEmail'))
    )
  );

  card.addSection(aiSection);

  // ── Draft Reply (still works if API is fixed) ──
  var replySection = CardService.newCardSection()
    .setHeader('Draft Reply')
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(0);

  var toneButtons = CardService.newButtonSet();
  ['warm', 'professional', 'brief'].forEach(function(tone) {
    toneButtons.addButton(
      CardService.newTextButton()
        .setText(capitalize_(tone))
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onDraftReply')
            .setParameters({ tone: tone })
        )
    );
  });
  replySection.addWidget(toneButtons);

  replySection.addWidget(
    CardService.newTextInput()
      .setFieldName('reply_instructions')
      .setTitle('Custom instructions')
      .setHint('e.g. "Include 3-year quote"')
      .setMultiline(true)
  );

  replySection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('reply_tone')
      .setTitle('Tone')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Warm', 'warm', true)
      .addItem('Professional', 'professional', false)
      .addItem('Brief', 'brief', false)
  );

  replySection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Draft with Instructions')
        .setOnClickAction(CardService.newAction().setFunctionName('onDraftReplyCustom'))
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_BLUE)
    )
  );

  card.addSection(replySection);

  // ── Quick Quote ──
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
    addBackButton_(card);
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
      .setHeader('⚠️ EOL Warnings');
    result.eolWarnings.forEach(function(w) {
      eolSection.addWidget(
        CardService.newDecoratedText()
          .setText(w)
          .setWrapText(true)
      );
    });
    card.addSection(eolSection);
  }

  addBackButton_(card);
  return card.build();
}

// ─────────────────────────────────────────────
// DRAFT REPLY CARD
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
    addBackButton_(card);
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

  addBackButton_(card);
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
    addBackButton_(card);
    return card.build();
  }

  var records = result.records || [];
  if (records.length === 0) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No results for "' + query + '" in ' + module + '.')
      )
    );
    addBackButton_(card);
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

  addBackButton_(card);
  return card.build();
}

// ─────────────────────────────────────────────
// QUOTE BUILDER CARD (compose trigger)
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

  addBackButton_(card);
  return card.build();
}

// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

function addBackButton_(card) {
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('← Back')
          .setOnClickAction(CardService.newAction().setFunctionName('onBackToHome'))
      )
    )
  );
}
