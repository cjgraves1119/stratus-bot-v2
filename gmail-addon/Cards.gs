/**
 * Stratus AI Gmail Add-on — Card Builders
 *
 * All CardService UI construction lives here.
 */

// ─────────────────────────────────────────────
// HOMEPAGE CARD
// ─────────────────────────────────────────────

function buildHomepageCard_() {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Cisco/Meraki Sales Assistant')
        .setImageStyle(CardService.ImageStyle.CIRCLE)
        .setImageUrl('https://stratusinfosystems.com/wp-content/uploads/2023/06/cropped-Stratus-Information-Systems-Square-32x32.png')
    );

  // Quick Quote section
  const quoteSection = CardService.newCardSection()
    .setHeader('Quick Quote');

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
        .setText('Generate Quote')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onGenerateQuote')
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_COLOR)
    )
  );

  card.addSection(quoteSection);

  // CRM Search section
  const crmSection = CardService.newCardSection()
    .setHeader('CRM Lookup');

  crmSection.addWidget(
    CardService.newTextInput()
      .setFieldName('crm_search_input')
      .setTitle('Search')
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
  );

  crmSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Search CRM')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onCrmSearch')
        )
    )
  );

  card.addSection(crmSection);

  return card.build();
}

// ─────────────────────────────────────────────
// EMAIL ANALYSIS CARD (contextual trigger result)
// ─────────────────────────────────────────────

function buildEmailAnalysisCard_(subject, sender, analysis) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle(truncate_(subject, 50))
    );

  // Summary section
  if (analysis.summary) {
    const summarySection = CardService.newCardSection()
      .setHeader('Summary');

    summarySection.addWidget(
      CardService.newTextParagraph().setText(analysis.summary)
    );

    if (analysis.urgency) {
      const urgencyIcon = analysis.urgency === 'high' ? '🔴' :
                         analysis.urgency === 'medium' ? '🟡' : '🟢';
      summarySection.addWidget(
        CardService.newDecoratedText()
          .setText(urgencyIcon + ' ' + capitalize_(analysis.urgency) + ' priority')
          .setWrapText(true)
      );
    }

    if (analysis.actionItems && analysis.actionItems.length > 0) {
      summarySection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Action Items')
          .setText(analysis.actionItems.join('\n'))
          .setWrapText(true)
      );
    }

    card.addSection(summarySection);
  }

  // Sender / CRM section
  const senderSection = CardService.newCardSection()
    .setHeader('Sender');

  senderSection.addWidget(
    CardService.newDecoratedText()
      .setText(sender.name)
      .setBottomLabel(sender.email)
      .setWrapText(true)
  );

  if (analysis.crmAccount) {
    const acct = analysis.crmAccount;
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
      const dealText = acct.recentDeals.map(d =>
        d.Deal_Name + ' (' + (d.Stage || 'unknown') + ')'
      ).join('\n');
      senderSection.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Recent Deals')
          .setText(dealText)
          .setWrapText(true)
      );
    }
  } else {
    // No CRM match, offer to search
    senderSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Search CRM')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('onCrmLookup')
              .setParameters({ query: sender.email, module: 'Contacts' })
          )
      )
    );
  }

  card.addSection(senderSection);

  // Detected SKUs section (if any)
  if (analysis.detectedSkus && analysis.detectedSkus.length > 0) {
    const skuSection = CardService.newCardSection()
      .setHeader('Detected Products');

    const skuList = analysis.detectedSkus.map(s =>
      (s.qty > 1 ? s.qty + 'x ' : '') + s.sku
    ).join(', ');

    skuSection.addWidget(
      CardService.newDecoratedText()
        .setText(skuList)
        .setWrapText(true)
    );

    skuSection.addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('Generate Quote')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onDetectSkus')
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(CONFIG.STRATUS_COLOR)
      )
    );

    card.addSection(skuSection);
  }

  // Actions section
  const actionsSection = CardService.newCardSection()
    .setHeader('Actions');

  // Draft Reply buttons (warm / professional / brief)
  const replyButtons = CardService.newButtonSet();
  ['warm', 'professional', 'brief'].forEach(function(tone) {
    replyButtons.addButton(
      CardService.newTextButton()
        .setText(capitalize_(tone) + ' Reply')
        .setOnClickAction(
          CardService.newAction()
            .setFunctionName('onDraftReply')
            .setParameters({ tone: tone })
        )
    );
  });
  actionsSection.addWidget(replyButtons);

  // Custom reply instructions
  actionsSection.addWidget(
    CardService.newTextInput()
      .setFieldName('reply_instructions')
      .setTitle('Reply instructions (optional)')
      .setHint('e.g. "Include 3-year quote for their MR44s"')
  );

  actionsSection.addWidget(
    CardService.newSelectionInput()
      .setFieldName('reply_tone')
      .setTitle('Tone')
      .setType(CardService.SelectionInputType.DROPDOWN)
      .addItem('Warm', 'warm', true)
      .addItem('Professional', 'professional', false)
      .addItem('Brief', 'brief', false)
  );

  actionsSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Draft Custom Reply')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onDraftReplyCustom')
        )
    )
  );

  // Manual quote builder
  actionsSection.addWidget(
    CardService.newTextInput()
      .setFieldName('sku_input')
      .setTitle('Quick Quote')
      .setHint('e.g. 10 MR44, 5 MS130-24P')
      .setMultiline(true)
  );

  actionsSection.addWidget(
    CardService.newButtonSet().addButton(
      CardService.newTextButton()
        .setText('Generate Quote')
        .setOnClickAction(
          CardService.newAction().setFunctionName('onGenerateQuote')
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_COLOR)
    )
  );

  card.addSection(actionsSection);

  return card.build();
}

// ─────────────────────────────────────────────
// QUOTE RESULT CARD
// ─────────────────────────────────────────────

function buildQuoteResultCard_(result) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Quote Generated')
        .setSubtitle('Stratus URL Quote')
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('Error: ' + result.error)
      )
    );
    return card.build();
  }

  // Quote URLs
  if (result.quoteUrls && result.quoteUrls.length > 0) {
    const urlSection = CardService.newCardSection()
      .setHeader('Quote Links');

    result.quoteUrls.forEach(function(q) {
      urlSection.addWidget(
        CardService.newDecoratedText()
          .setText(q.label || q.term || 'Quote')
          .setWrapText(true)
          .setButton(
            CardService.newTextButton()
              .setText('Open')
              .setOpenLink(
                CardService.newOpenLink().setUrl(q.url)
              )
          )
      );
    });

    card.addSection(urlSection);
  }

  // Full response text (if the bot returned prose)
  if (result.responseText) {
    card.addSection(
      CardService.newCardSection()
        .setHeader('Details')
        .addWidget(
          CardService.newTextParagraph().setText(
            truncate_(result.responseText, 2000)
          )
        )
    );
  }

  // EOL warnings
  if (result.eolWarnings && result.eolWarnings.length > 0) {
    const eolSection = CardService.newCardSection()
      .setHeader('EOL Warnings');
    result.eolWarnings.forEach(function(w) {
      eolSection.addWidget(
        CardService.newDecoratedText()
          .setText('⚠️ ' + w)
          .setWrapText(true)
      );
    });
    card.addSection(eolSection);
  }

  // Back button
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('← Back')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onHomepage')
          )
      )
    )
  );

  return card.build();
}

// ─────────────────────────────────────────────
// DRAFT REPLY CARD
// ─────────────────────────────────────────────

function buildDraftReplyCard_(result, emailCtx) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Draft Reply')
        .setSubtitle('Re: ' + truncate_(emailCtx.subject, 40))
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('Error: ' + result.error)
      )
    );
    return card.build();
  }

  // Display each draft option
  const drafts = result.drafts || [result.draft || result.reply || ''];
  drafts.forEach(function(draft, idx) {
    const section = CardService.newCardSection()
      .setHeader('Option ' + (idx + 1));

    section.addWidget(
      CardService.newTextParagraph().setText(draft)
    );

    section.addWidget(
      CardService.newButtonSet()
        .addButton(
          CardService.newTextButton()
            .setText('Create Gmail Draft')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onInsertDraft')
                .setParameters({ draft_body: draft })
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor(CONFIG.STRATUS_COLOR)
        )
        .addButton(
          CardService.newTextButton()
            .setText('Copy')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onCopyText')
                .setParameters({ text: draft })
            )
        )
    );

    card.addSection(section);
  });

  return card.build();
}

// ─────────────────────────────────────────────
// CRM RESULT CARD
// ─────────────────────────────────────────────

function buildCrmResultCard_(result, query, module) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('CRM Results')
        .setSubtitle(module + ': "' + truncate_(query, 30) + '"')
    );

  if (result.error) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('Error: ' + result.error)
      )
    );
    return card.build();
  }

  const records = result.records || [];
  if (records.length === 0) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText('No results found for "' + query + '" in ' + module + '.')
      )
    );
    return card.build();
  }

  records.forEach(function(rec) {
    const section = CardService.newCardSection();

    // Determine display name based on module
    let displayName = rec.Account_Name || rec.Deal_Name ||
      ((rec.First_Name || '') + ' ' + (rec.Last_Name || '')).trim() ||
      rec.Subject || rec.name || 'Record';

    section.addWidget(
      CardService.newDecoratedText()
        .setText(displayName)
        .setBottomLabel(rec.Email || rec.Phone || rec.Stage || '')
        .setWrapText(true)
        .setButton(
          CardService.newTextButton()
            .setText('Open')
            .setOpenLink(
              CardService.newOpenLink()
                .setUrl(CONFIG.ZOHO_ORG_URL + '/tab/' + module + '/' + rec.id)
            )
        )
    );

    // Extra details
    if (rec.Stage) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Stage')
          .setText(rec.Stage)
          .setWrapText(true)
      );
    }
    if (rec.Amount) {
      section.addWidget(
        CardService.newDecoratedText()
          .setTopLabel('Amount')
          .setText('$' + Number(rec.Amount).toLocaleString())
      );
    }

    card.addSection(section);
  });

  // Back button
  card.addSection(
    CardService.newCardSection().addWidget(
      CardService.newButtonSet().addButton(
        CardService.newTextButton()
          .setText('← Back')
          .setOnClickAction(
            CardService.newAction().setFunctionName('onHomepage')
          )
      )
    )
  );

  return card.build();
}

// ─────────────────────────────────────────────
// QUOTE BUILDER CARD (for compose trigger)
// ─────────────────────────────────────────────

function buildQuoteBuilderCard_(prefill) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Insert Quote')
        .setSubtitle('Generate a Stratus URL quote')
    );

  const section = CardService.newCardSection();

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
        .setOnClickAction(
          CardService.newAction().setFunctionName('onGenerateQuote')
        )
        .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        .setBackgroundColor(CONFIG.STRATUS_COLOR)
    )
  );

  card.addSection(section);
  return card.build();
}

// ─────────────────────────────────────────────
// DEGRADED / ERROR CARDS
// ─────────────────────────────────────────────

function buildDegradedEmailCard_(subject, sender, errorMsg) {
  const card = CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle(truncate_(subject, 50))
    );

  card.addSection(
    CardService.newCardSection()
      .setHeader('Sender')
      .addWidget(
        CardService.newDecoratedText()
          .setText(sender.name)
          .setBottomLabel(sender.email)
          .setWrapText(true)
      )
      .addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText('Search CRM')
            .setOnClickAction(
              CardService.newAction()
                .setFunctionName('onCrmLookup')
                .setParameters({ query: sender.email, module: 'Contacts' })
            )
        )
      )
  );

  // Manual quote builder still works even if API is down
  card.addSection(
    CardService.newCardSection()
      .setHeader('Quick Quote')
      .addWidget(
        CardService.newTextInput()
          .setFieldName('sku_input')
          .setTitle('Enter SKUs')
          .setHint('e.g. 10 MR44, 5 MS130-24P')
          .setMultiline(true)
      )
      .addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText('Generate Quote')
            .setOnClickAction(
              CardService.newAction().setFunctionName('onGenerateQuote')
            )
            .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
            .setBackgroundColor(CONFIG.STRATUS_COLOR)
        )
      )
  );

  if (errorMsg) {
    card.addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          '<font color="#999">AI features temporarily unavailable: ' + truncate_(errorMsg, 100) + '</font>'
        )
      )
    );
  }

  return card.build();
}

function buildErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Stratus AI')
        .setSubtitle('Error')
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(message)
      )
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newButtonSet().addButton(
          CardService.newTextButton()
            .setText('← Back')
            .setOnClickAction(
              CardService.newAction().setFunctionName('onHomepage')
            )
        )
      )
    )
    .build();
}

// ─────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────

function truncate_(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

function capitalize_(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Copy text to clipboard via notification (Apps Script doesn't have clipboard API).
 */
function onCopyText(e) {
  return CardService.newActionResponseBuilder()
    .setNotification(
      CardService.newNotification().setText('Draft text copied to clipboard is not available in Gmail add-ons. Use "Create Gmail Draft" instead.')
    )
    .build();
}
