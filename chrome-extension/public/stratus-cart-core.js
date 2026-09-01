(function(root,factory){
  "use strict";
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.StratusCartCore=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const ALLOWED_HOSTS=new Set(["stratusinfosystems.com","www.stratusinfosystems.com"]);
  const MAX_ROWS=100;
  const MAX_QTY=10000;

  // Exact, reviewable decomposition rules for the three Stratus bundle titles
  // supplied with this feature. Prices are intentionally NOT stored here; the
  // existing deterministic pricing endpoint remains the price authority.
  const BUNDLE_RULES=Object.freeze([
    Object.freeze({
      id:"cw9176d1-directional-enterprise-1yr",
      title:"Hardware + License, Wireless CW9176D1 Access Point Directional Antenna w/ 1YR Enterprise License",
      components:Object.freeze(["CW9176D1-RTG","LIC-ENT-1YR"]),
    }),
    Object.freeze({
      id:"ms150-48lp-4x-essentials-renewal-1yr",
      title:"Hardware + License, Meraki MS150-48LP-4X Hardware and Essentials License Renewal, 1 Year",
      components:Object.freeze(["MS150-48LP-4X","LIC-MS150-48-1Y"]),
    }),
    Object.freeze({
      id:"ms130-48x-enterprise-1yr",
      title:"Hardware + License, Meraki MS130-48X Cloud Mgd. 40GE + 8x(2.5GE) 740W PoE Switch w/ 1Y Enterprise License",
      components:Object.freeze(["MS130-48X","LIC-MS130-48-1Y"]),
    }),
  ]);

  function normalizeText(value){
    return String(value==null?"":value).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  }

  function allowedCartUrl(value){
    try{
      const url=new URL(String(value||""));
      return url.protocol==="https:"&&!url.port&&ALLOWED_HOSTS.has(url.hostname.toLowerCase())&&/^\/(?:cart|order)\/?$/.test(url.pathname);
    }catch{return false}
  }

  function isOrderUrl(value){
    try{
      const url=new URL(String(value||""));
      return url.protocol==="https:"&&!url.port&&ALLOWED_HOSTS.has(url.hostname.toLowerCase())&&/^\/order\/?$/.test(url.pathname);
    }catch{return false}
  }

  function parseOrderUrl(value){
    let url;
    try{url=new URL(String(value||""))}catch{return{items:[],unresolved:[{title:"Order URL",reason:"The URL is invalid."}],complete:false}}
    if(!isOrderUrl(url.href)||url.username||url.password||url.hash){
      return{items:[],unresolved:[{title:"Order URL",reason:"Only the exact HTTPS Stratus /order/ route is accepted."}],complete:false};
    }
    if(url.searchParams.getAll("item").length!==1||url.searchParams.getAll("qty").length!==1){
      return{items:[],unresolved:[{title:"Order URL",reason:"Exactly one item list and one quantity list are required."}],complete:false};
    }
    const rawItems=url.searchParams.get("item")||"";
    const rawQuantities=url.searchParams.get("qty")||"";
    const skus=rawItems.split(",").map(validSku);
    const quantities=rawQuantities.split(",").map(value=>Number(String(value).trim()));
    if(!skus.length||skus.length>MAX_ROWS||skus.some(sku=>!sku)){
      return{items:[],unresolved:[{title:"Order URL",reason:"The item list contains an invalid SKU or exceeds the safe row limit."}],complete:false};
    }
    if(quantities.length!==skus.length||quantities.some(qty=>!Number.isInteger(qty)||qty<1||qty>MAX_QTY)){
      return{items:[],unresolved:[{title:"Order URL",reason:"Each SKU must have one matching whole-number quantity within the safe limit."}],complete:false};
    }
    const order=[];
    const totals=new Map;
    for(let index=0;index<skus.length;index++){
      const sku=skus[index];
      if(!totals.has(sku))order.push(sku);
      const combined=(totals.get(sku)||0)+quantities[index];
      if(combined>MAX_QTY){
        return{items:[],unresolved:[{title:sku,reason:`Aggregated quantity exceeds the safe limit of ${MAX_QTY}.`}],complete:false};
      }
      totals.set(sku,combined);
    }
    return{
      sourceUrl:`${url.origin}${url.pathname}?item=${encodeURIComponent(rawItems)}&qty=${encodeURIComponent(rawQuantities)}`,
      items:order.map(sku=>({sku,qty:totals.get(sku)})),
      bundleRows:[],
      unresolved:[],
      complete:true,
    };
  }

  function parseMoneyText(value){
    const raw=normalizeText(value);
    if(!raw||(!raw.includes("$")&&!/\bUSD\b/i.test(raw)))return null;
    const match=raw.match(/(?:USD\s*)?\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/i);
    if(!match)return null;
    const amount=match[1].replace(/,/g,"");
    if(!/^\d+(?:\.\d{1,2})?$/.test(amount))return null;
    const [whole,fraction=""]=amount.split(".");
    const cents=Number(whole)*100+Number((fraction+"00").slice(0,2));
    return Number.isSafeInteger(cents)&&cents>=0?cents:null;
  }

  function validSku(value){
    const sku=normalizeText(value).replace(/^SKU\s*:\s*/i,"").toUpperCase();
    return sku.length>=3&&sku.length<=90&&/[A-Z]/.test(sku)&&/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku)?sku:null;
  }

  function matchingBundleRules(title){
    const normalized=normalizeText(title).toLowerCase();
    return BUNDLE_RULES.filter(rule=>normalized===normalizeText(rule.title).toLowerCase());
  }

  function resolveCartRows(extraction){
    const rows=Array.isArray(extraction?.rows)?extraction.rows:[];
    const unresolved=[];
    const bundleRows=[];
    const itemOrder=[];
    const quantities=new Map;

    if(extraction?.error){
      return{sourceUrl:"",items:[],bundleRows:[],unresolved:[{title:"Cart",reason:normalizeText(extraction.error)||"Cart extraction failed."}],complete:false};
    }
    if(rows.length===0){
      return{sourceUrl:normalizeText(extraction?.sourceUrl),items:[],bundleRows:[],unresolved:[{title:"Cart",reason:"No visible cart rows were found; no quote was produced."}],complete:false};
    }
    if(rows.length>MAX_ROWS){
      return{sourceUrl:normalizeText(extraction?.sourceUrl),items:[],bundleRows:[],unresolved:[{title:"Cart",reason:`The cart contains more than ${MAX_ROWS} rows, so no partial quote was produced.`}],complete:false};
    }
    for(const [rowIndex,row] of rows.entries()){
      const rawTitle=normalizeText(row?.title);
      const qty=Number(row?.quantity);
      const explicit=[...new Set((Array.isArray(row?.explicitSkus)?row.explicitSkus:[]).map(validSku).filter(Boolean))];
      const title=rawTitle||explicit.join(" + ")||`Cart row ${rowIndex+1}`;
      if(!Number.isInteger(qty)||qty<1||qty>MAX_QTY){
        unresolved.push({title,reason:"Cart row is missing one unambiguous live whole-number quantity within the safe limit."});
        continue;
      }
      const unit=Number.isSafeInteger(row?.activeUnitCents)&&row.activeUnitCents>=0?row.activeUnitCents:null;
      const subtotal=Number.isSafeInteger(row?.subtotalCents)&&row.subtotalCents>=0?row.subtotalCents:null;
      const expectedSubtotal=unit===null?null:unit*qty;
      const pricingStatus=unit!==null&&subtotal!==null&&Number.isSafeInteger(expectedSubtotal)
        ?(expectedSubtotal===subtotal?"reconciled":"mismatch")
        :"unavailable";

      // SKU identity + the live quantity are the quote authority. Visible cart
      // prices are optional metadata only: missing or mismatched arithmetic must
      // never suppress otherwise safe SKU × quantity output.
      const rules=rawTitle?matchingBundleRules(rawTitle):[];
      let components=[];
      let provenance="";
      if(explicit.length){
        if(rules.length===1&&explicit.every(sku=>rules[0].components.includes(sku))){
          components=[...rules[0].components];
          provenance=`explicit-cart-sku+exact-title-map:${rules[0].id}`;
        }else{
          components=explicit;
          provenance="explicit-cart-sku";
        }
      }else if(rules.length===1){
        components=[...rules[0].components];
        provenance=`exact-title-map:${rules[0].id}`;
      }else if(rules.length>1){
        unresolved.push({title,reason:"More than one exact bundle rule matched; no SKU inference was used."});
        continue;
      }else{
        unresolved.push({title,reason:"No explicit SKU or exact reviewed bundle mapping was available."});
        continue;
      }

      const lineComponents=[];
      for(const component of components){
        const sku=validSku(component);
        if(!sku)continue;
        if(!quantities.has(sku))itemOrder.push(sku);
        const combined=(quantities.get(sku)||0)+qty;
        if(combined>MAX_QTY){
          unresolved.push({title,reason:`Aggregated quantity for ${sku} exceeds the safe limit of ${MAX_QTY}.`});
          continue;
        }
        quantities.set(sku,combined);
        lineComponents.push(sku);
      }
      if(lineComponents.length===0){
        unresolved.push({title,reason:"Resolved component SKUs failed validation."});
        continue;
      }
      bundleRows.push({
        title,
        quantity:qty,
        activeUnitCents:unit,
        subtotalCents:subtotal,
        pricingStatus,
        pricingNote:pricingStatus==="mismatch"
          ?`Optional visible pricing did not reconcile (${unit} cents × ${qty} ≠ ${subtotal} cents).`
          :(pricingStatus==="unavailable"?"Optional visible unit/subtotal pricing was unavailable.":""),
        components:lineComponents,
        provenance,
      });
    }

    if(unresolved.length){
      return{sourceUrl:normalizeText(extraction?.sourceUrl),items:[],bundleRows:[],unresolved,complete:false};
    }
    return{
      sourceUrl:normalizeText(extraction?.sourceUrl),
      items:itemOrder.map(sku=>({sku,qty:quantities.get(sku)})),
      bundleRows,
      unresolved,
      complete:true,
    };
  }

  function buildPricingRequest(items){
    const source=Array.isArray(items)?items:[];
    const safe=source.map(item=>({sku:validSku(item?.sku),qty:Number(item?.qty)}));
    if(!safe.length||safe.length!==source.length||safe.some(item=>!item.sku||!Number.isInteger(item.qty)||item.qty<=0||item.qty>MAX_QTY))return"";
    return`Pricing for these exact Stratus ecommerce SKUs and quantities (one line per SKU with unit and total):\n${safe.map(item=>`${item.qty} ${item.sku}`).join("\n")}`;
  }

  function parsePricingResponse(value,items){
    const text=String(value||"");
    const lines=text.split(/\r?\n/).map(line=>normalizeText(line.replace(/\*\*/g,""))).filter(Boolean);
    const priced=[];
    const unresolved=[];
    for(const item of Array.isArray(items)?items:[]){
      const sku=validSku(item?.sku);
      const qty=Number(item?.qty);
      if(!sku||!Number.isInteger(qty)||qty<1){
        unresolved.push({sku:sku||normalizeText(item?.sku),reason:"Invalid expected SKU or quantity."});
        continue;
      }
      const escaped=sku.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
      const lineRe=new RegExp(`^(?:[•*\\-]\\s*)?${escaped}\\s*(?:×|x|\\*)\\s*${qty}\\s*(?:—|–|-)\\s*(?:USD\\s*)?\\$\\s*([0-9][0-9,]*(?:\\.\\d{1,2})?)\\s*(?:ea|each|per\\s+unit)\\s*(?:—|–|-)\\s*(?:USD\\s*)?\\$\\s*([0-9][0-9,]*(?:\\.\\d{1,2})?)\\s*total\\s*$`,`i`);
      const matching=lines.map(line=>({line,match:line.match(lineRe)})).filter(candidate=>candidate.match);
      if(matching.length!==1){
        unresolved.push({sku,reason:matching.length?"Pricing response contains more than one candidate line.":"Pricing response did not contain an exact SKU line."});
        continue;
      }
      const unit=parseMoneyText(`$${matching[0].match[1]}`);
      const total=parseMoneyText(`$${matching[0].match[2]}`);
      if(!Number.isSafeInteger(unit)||!Number.isSafeInteger(total)){
        unresolved.push({sku,reason:"Exact unit and total prices could not be read from the pricing line."});
        continue;
      }
      if(unit*qty!==total){
        unresolved.push({sku,reason:`Pricing arithmetic does not reconcile (${unit} cents × ${qty} ≠ ${total} cents).`});
        continue;
      }
      priced.push({sku,qty,unitCents:unit,totalCents:total,sourceLine:matching[0].line});
    }
    return{priced,unresolved};
  }

  function reconcileBundlePricing(bundleRows,pricedItems){
    const bySku=new Map;
    const unresolved=[];
    for(const item of Array.isArray(pricedItems)?pricedItems:[]){
      const sku=validSku(item?.sku);
      if(!sku)continue;
      if(bySku.has(sku)){
        unresolved.push({title:sku,reason:"Duplicate catalog pricing rows prevent unique reconciliation."});
        continue;
      }
      bySku.set(sku,item);
    }
    const conflicts=[];
    for(const row of Array.isArray(bundleRows)?bundleRows:[]){
      const componentItems=row.components.map(sku=>bySku.get(validSku(sku)));
      if(componentItems.some(item=>!item)){
        unresolved.push({title:row.title,reason:"At least one component lacks a unique verified catalog price."});
        continue;
      }
      if(componentItems.some(item=>item.qty!==row.quantity||item.totalCents!==item.unitCents*item.qty)){
        unresolved.push({title:row.title,reason:"Component quantity or total does not match the cart row quantity."});
        continue;
      }
      const prices=componentItems.map(item=>item.unitCents);
      const catalogUnitCents=prices.reduce((sum,value)=>sum+value,0);
      // Cart pricing is optional metadata. When absent or internally
      // inconsistent, SKU parsing remains valid and there is no cart-price
      // authority to compare against the deterministic catalog result.
      if(row.pricingStatus!=="reconciled"||!Number.isSafeInteger(row.activeUnitCents)||!Number.isSafeInteger(row.subtotalCents))continue;
      if(catalogUnitCents!==row.activeUnitCents){
        conflicts.push({
          title:row.title,
          quantity:row.quantity,
          components:[...row.components],
          cartUnitCents:row.activeUnitCents,
          catalogUnitCents,
          deltaUnitCents:catalogUnitCents-row.activeUnitCents,
          cartTotalCents:row.subtotalCents,
          catalogTotalCents:catalogUnitCents*row.quantity,
        });
      }
    }
    return{conflicts,unresolved,complete:unresolved.length===0};
  }

  function formatUsd(cents){
    if(!Number.isSafeInteger(cents))return"unresolved";
    const dollars=cents/100;
    return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:cents%100?2:0,maximumFractionDigits:2}).format(dollars);
  }

  function formatPricedLine(item){
    return`${item.sku} × ${item.qty} — ${formatUsd(item.unitCents)} ea — ${formatUsd(item.totalCents)} total`;
  }

  // This function is deliberately self-contained so Chrome can serialize it
  // into the active Stratus cart tab under the existing activeTab permission.
  function extractCartDocument(){
    const normalize=value=>String(value==null?"":value).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
    const parseMoney=value=>{
      const raw=normalize(value);
      if(!raw||(!raw.includes("$")&&!/\bUSD\b/i.test(raw)))return null;
      const match=raw.match(/(?:USD\s*)?\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![\d.,])/i);
      if(!match)return null;
      const amount=match[1].replace(/,/g,"");
      const parts=amount.split(".");
      const cents=Number(parts[0])*100+Number(((parts[1]||"")+"00").slice(0,2));
      return Number.isSafeInteger(cents)&&cents>=0?cents:null;
    };
    const isVisible=el=>{
      if(!el||el.nodeType!==1||el.closest?.('[aria-hidden="true"]'))return false;
      const style=window.getComputedStyle?.(el);
      if(style&&(style.display==="none"||style.visibility==="hidden"))return false;
      const rect=el.getBoundingClientRect?.();
      return!rect||(rect.width>0&&rect.height>0);
    };
    const textOf=el=>normalize(el?.innerText||el?.textContent||"");
    const skuValue=value=>{
      const sku=normalize(value).replace(/^SKU\s*:\s*/i,"").toUpperCase();
      return sku.length>=3&&sku.length<=90&&/[A-Z]/.test(sku)&&/^[A-Z0-9][A-Z0-9._/-]*$/.test(sku)?sku:null;
    };
    const moneyCandidates=(row,selectors)=>{
      const nodes=[];
      for(const selector of selectors)row.querySelectorAll?.(selector).forEach?.(node=>nodes.push(node));
      const values=[...new Set(nodes.filter(isVisible).filter(node=>!node.closest?.("del,s")).map(node=>parseMoney(textOf(node))).filter(value=>value!==null))];
      return values.length===1?values[0]:null;
    };

    let pageUrl;
    try{pageUrl=new URL(String(location.href||""))}catch{return{error:"The active page URL is invalid.",rows:[]}}
    const allowedHosts=new Set(["stratusinfosystems.com","www.stratusinfosystems.com"]);
    if(pageUrl.protocol!=="https:"||pageUrl.port||!allowedHosts.has(pageUrl.hostname.toLowerCase())||!/^\/cart\/?$/.test(pageUrl.pathname)){
      return{error:"Open the exact HTTPS Stratus cart page before reading it.",rows:[]};
    }

    const rowSelectors=[".woocommerce-cart-form__cart-item","tr.cart_item",".woocommerce-cart-form .cart_item","[data-cart-item-key]",".cart_item"];
    const candidates=[];
    for(const selector of rowSelectors)document.querySelectorAll(selector).forEach(row=>candidates.push(row));
    const uniqueRows=[...new Set(candidates)].filter(isVisible);
    if(uniqueRows.length>100)return{error:"The cart has more than 100 visible rows; no partial quote was produced.",sourceUrl:`${pageUrl.origin}${pageUrl.pathname}`,rows:[]};
    const rows=uniqueRows.map((row,index)=>{
      const titleNode=row.querySelector?.(".product-name a, .product-name, [data-product-name]");
      const title=textOf(titleNode);
      const qtyNodes=[...row.querySelectorAll?.('input.qty,input[name*="cart"][name*="qty"],input[type="number"]')||[]].filter(isVisible);
      const qtyValues=[...new Set(qtyNodes.map(input=>Number(input.value)).filter(value=>Number.isInteger(value)&&value>0&&value<=10000))];
      const quantity=qtyValues.length===1?qtyValues[0]:null;
      const activeUnitCents=moneyCandidates(row,[
        ".product-price ins .woocommerce-Price-amount",
        ".product-price ins",
        ".product-price .woocommerce-Price-amount",
      ]);
      const subtotalCents=moneyCandidates(row,[
        ".product-subtotal .woocommerce-Price-amount",
        ".product-subtotal",
      ]);
      const explicit=[];
      for(const attr of["data-sku","data-product_sku","data-product-sku"]){
        const direct=skuValue(row.getAttribute?.(attr));
        if(direct)explicit.push(direct);
        row.querySelectorAll?.(`[${attr}]`).forEach?.(node=>{if(!isVisible(node))return;const value=skuValue(node.getAttribute?.(attr));if(value)explicit.push(value)});
      }
      row.querySelectorAll?.(".product-sku .sku, .product-sku, [data-role='sku']").forEach?.(node=>{if(!isVisible(node))return;const value=skuValue(textOf(node));if(value)explicit.push(value)});
      return{
        title:title.slice(0,500),
        quantity,
        activeUnitCents,
        subtotalCents,
        explicitSkus:[...new Set(explicit)].slice(0,20),
      };
    });
    return{sourceUrl:`${pageUrl.origin}${pageUrl.pathname}`,currency:"USD",rows};
  }

  return{
    BUNDLE_RULES,
    allowedCartUrl,
    isOrderUrl,
    parseOrderUrl,
    parseMoneyText,
    validSku,
    matchingBundleRules,
    resolveCartRows,
    buildPricingRequest,
    parsePricingResponse,
    reconcileBundlePricing,
    formatUsd,
    formatPricedLine,
    extractCartDocument,
  };
});
