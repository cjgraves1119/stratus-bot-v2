/**
 * Order status — exact contact match required, plus a specific reference token
 * in the inbound body. Returns ONLY Status + Tracking. Never financial fields.
 *
 * If the reference token resolves to an order belonging to a DIFFERENT account
 * than the matched contact, we escalate (don't leak cross-account data).
 */

export async function handleOrderStatus(env, ctx) {
  const { envelope, classification, match } = ctx;
  const refs = classification.extracted.reference_tokens || [];

  if (!refs.length || !match.account?.id) {
    return {
      kind: "order_status_miss",
      bodySegments: [
        `Thanks for checking in!`,
        `I couldn't find a specific reference (PO #, SO #, quote # or tracking #) in your message — I've looped in Jay Florendo who can pull this up.`,
      ],
      extraCcJay: true,
    };
  }

  // Try Sales_Orders, then Invoices, then Quotes for each reference
  const found = [];
  for (const ref of refs) {
    const so = await crmSearch(env, "Sales_Orders", `(Subject:contains:${ref})or(Sales_Order_Number:contains:${ref})or(PO_Number:contains:${ref})`, [
      "Subject", "Sales_Order_Number", "PO_Number", "Status", "Shipping_Tracking_Number", "Account_Name",
    ]);
    for (const r of so) {
      if (r.Account_Name?.id === match.account.id) found.push({ type: "Sales Order", record: r });
    }
  }

  if (!found.length) {
    return {
      kind: "order_status_miss",
      bodySegments: [
        `Thanks for checking in on your order!`,
        `I couldn't find a matching order on your account using the references you mentioned. I've looped in Jay Florendo to take a closer look.`,
      ],
      extraCcJay: true,
    };
  }

  const lines = found.map(f => {
    const r = f.record;
    return `• ${f.type} ${r.Sales_Order_Number || r.Subject || ""}: ${r.Status || "Status unknown"}${r.Shipping_Tracking_Number ? ` (tracking: ${r.Shipping_Tracking_Number})` : ""}`;
  });

  return {
    kind: "order_status",
    bodySegments: [
      `Thanks for checking in!`,
      `Here's what I found:`,
      lines.join("\n"),
      `If anything doesn't look right or you need more detail (carrier, ETA, PO copies, etc), just reply back and we'll dig in.`,
    ],
  };
}

async function crmSearch(env, module, criteria, fields) {
  try {
    const res = await env.GCHAT.fetch("https://internal/api/crm-search", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.GCHAT_INTERNAL_TOKEN },
      body: JSON.stringify({ module, criteria, fields, limit: 10 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data || [];
  } catch {
    return [];
  }
}
