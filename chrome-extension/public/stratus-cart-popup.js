(function(){
  "use strict";
  const core=globalThis.StratusCartCore;
  if(!core||globalThis.__STRATUS_CART_POPUP_V1__)return;
  globalThis.__STRATUS_CART_POPUP_V1__=true;
  const isSidebar=/\/sidebar\.html$/.test(location.pathname);

  const colors={blue:"#1a73a7",dark:"#202124",secondary:"#5f6368",border:"#dadce0",ok:"#137333",warn:"#b06000",error:"#b3261e"};

  function el(tag,props={},children=[]){
    const node=document.createElement(tag);
    for(const[key,value]of Object.entries(props)){
      if(key==="className")node.className=value;
      else if(key==="text")node.textContent=value;
      else if(key==="style")node.style.cssText=value;
      else node.setAttribute(key,value);
    }
    for(const child of[].concat(children||[]))if(child)node.appendChild(typeof child==="string"?document.createTextNode(child):child);
    return node;
  }

  function activeTab(){
    return new Promise((resolve,reject)=>{
      chrome.tabs.query({active:true,currentWindow:true},tabs=>{
        if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));
        resolve(tabs&&tabs[0]||null);
      });
    });
  }

  function injectCartReader(tabId){
    return new Promise((resolve,reject)=>{
      chrome.scripting.executeScript({target:{tabId},func:core.extractCartDocument},results=>{
        if(chrome.runtime.lastError){
          const message=chrome.runtime.lastError.message||"Cart access was denied.";
          if(/cannot access|permission|host/i.test(message)){
            const error=new Error("Cart access is not currently granted for this Stratus tab.");
            error.permissionRequired=true;
            return reject(error);
          }
          return reject(new Error(message));
        }
        const result=results&&results.length===1?results[0].result:null;
        if(!result)return reject(new Error("The Stratus cart did not return a readable result."));
        resolve(result);
      });
    });
  }

  function requestCartAccess(urlValue){
    return new Promise((resolve,reject)=>{
      let url;
      try{url=new URL(urlValue)}catch{return reject(new Error("The active Stratus cart URL is invalid."))}
      const origin=`${url.origin}/*`;
      chrome.permissions.contains({origins:[origin]},granted=>{
        if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));
        if(granted)return resolve(true);
        chrome.permissions.request({origins:[origin]},approved=>{
          if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));
          if(!approved)return reject(new Error("Stratus cart access was not granted. No page or CRM state was changed."));
          resolve(true);
        });
      });
    });
  }

  function setQuickQuoteText(items){
    if(isSidebar)return false;
    const textarea=document.querySelector('#root textarea[placeholder*="MR44"]');
    if(!textarea)return false;
    const value=items.map(item=>`${item.qty} ${item.sku}`).join("\n");
    const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;
    if(!setter)return false;
    setter.call(textarea,value);
    textarea.dispatchEvent(new Event("input",{bubbles:true}));
    return true;
  }

  function resultBlock(title,tone="neutral"){
    const palette=tone==="error"?{bg:"#fce8e6",fg:colors.error,border:"#f1aeb5"}
      :tone==="warn"?{bg:"#fff4e5",fg:colors.warn,border:"#f6c26b"}
      :tone==="ok"?{bg:"#e6f4ea",fg:colors.ok,border:"#a8dab5"}
      :{bg:"#f8f9fa",fg:colors.dark,border:colors.border};
    const block=el("div",{style:`margin-top:8px;padding:8px;border:1px solid ${palette.border};border-radius:7px;background:${palette.bg};color:${palette.fg};font-size:11px;line-height:1.4;`});
    block.appendChild(el("div",{text:title,style:"font-weight:700;margin-bottom:4px;"}));
    return block;
  }

  function appendLines(block,lines){
    for(const line of lines)block.appendChild(el("div",{text:line,style:"white-space:pre-wrap;overflow-wrap:anywhere;margin-top:2px;"}));
  }

  function mount(){
    if(document.getElementById("stratus-cart-reader"))return;
    const launcher=isSidebar?el("button",{
      id:"stratus-cart-reader-launcher",
      type:"button",
      text:"🛒 Read cart",
      style:`display:none;position:fixed;top:8px;right:44px;z-index:2147483639;padding:5px 8px;border:1px solid ${colors.blue};border-radius:6px;background:#fff;color:${colors.blue};font-size:10px;font-weight:700;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.12);`,
    }):null;
    const panel=el("section",{
      id:"stratus-cart-reader",
      style:isSidebar
        ?"display:none;position:fixed;top:42px;right:8px;z-index:2147483640;width:min(380px,calc(100vw - 16px));max-height:calc(100vh - 52px);overflow:auto;padding:10px;border:1px solid #dadce0;border-radius:8px;background:#fff;color:#202124;box-shadow:0 5px 22px rgba(0,0,0,.22);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
        :"margin:0 12px 12px;padding:10px;border:1px solid #dadce0;border-radius:8px;background:#fff;color:#202124;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;",
    });
    const headingRow=el("div",{style:"display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;"});
    const heading=el("div",{text:"Stratus Cart Reader",style:"font-size:13px;font-weight:700;"});
    const close=isSidebar?el("button",{type:"button",text:"×","aria-label":"Close Stratus Cart Reader",style:"padding:0 3px;border:0;background:transparent;color:#5f6368;font:700 18px/1 sans-serif;cursor:pointer;"}):null;
    headingRow.appendChild(heading);
    if(close)headingRow.appendChild(close);
    const intro=el("div",{
      text:"Reads an exact Stratus /order/ URL or the current HTTPS /cart page. It never changes the cart or creates CRM records.",
      style:"font-size:10px;line-height:1.35;color:#5f6368;margin-bottom:8px;",
    });
    const button=el("button",{
      type:"button",
      text:"Read current Stratus cart",
      style:`width:100%;padding:8px;border:0;border-radius:6px;background:${colors.blue};color:#fff;font-size:12px;font-weight:700;cursor:pointer;`,
    });
    const status=el("div",{role:"status","aria-live":"polite",style:"font-size:10px;line-height:1.35;color:#5f6368;margin-top:6px;"});
    const output=el("div",{className:"stratus-cart-output"});
    panel.append(headingRow,intro,button,status,output);
    if(launcher)document.body.appendChild(launcher);
    document.body.appendChild(panel);
    launcher?.addEventListener("click",()=>{panel.style.display="block"});
    close?.addEventListener("click",()=>{panel.style.display="none"});

    function setBusy(busy,label){
      button.disabled=busy;
      button.style.opacity=busy?"0.65":"1";
      button.style.cursor=busy?"default":"pointer";
      status.textContent=label||"";
    }

    function renderError(message){
      output.replaceChildren();
      const block=resultBlock("Cart was not verified","error");
      appendLines(block,[message]);
      output.appendChild(block);
    }

    async function refreshEligibility(){
      try{
        const tab=await activeTab();
        const allowed=core.allowedCartUrl(tab?.url);
        if(launcher)launcher.style.display=allowed?"block":"none";
        if(isSidebar&&!allowed)panel.style.display="none";
        button.disabled=!allowed;
        button.style.opacity=allowed?"1":"0.55";
        button.style.cursor=allowed?"pointer":"default";
        status.textContent=allowed?"Ready. SKU parsing runs only after you click.":"Open an exact HTTPS Stratus /order/ link or /cart/ page to enable this action.";
      }catch(error){
        if(launcher)launcher.style.display="none";
        button.disabled=true;
        status.textContent=`Active tab could not be verified: ${error.message}`;
      }
    }

    button.addEventListener("click",async()=>{
      output.replaceChildren();
      setBusy(true,"Reading the visible cart without changing it…");
      try{
        const tab=await activeTab();
        if(!tab?.id||!core.allowedCartUrl(tab.url))throw new Error("The active tab is not an exact HTTPS Stratus /order/ link or /cart/ page.");
        let resolved;
        if(core.isOrderUrl(tab.url)){
          resolved=core.parseOrderUrl(tab.url);
        }else{
          await requestCartAccess(tab.url);
          const extraction=await injectCartReader(tab.id);
          if(extraction.error)throw new Error(extraction.error);
          resolved=core.resolveCartRows(extraction);
        }

        if(resolved.unresolved.length){
          const warning=resultBlock("Rows that were not used","warn");
          appendLines(warning,resolved.unresolved.map(row=>`${row.title}: ${row.reason}`));
          output.appendChild(warning);
        }
        if(!resolved.complete||!resolved.items.length){
          const reasons=resolved.unresolved.map(row=>`${row.title}: ${row.reason}`).join(" ");
          throw new Error(reasons||"No cart rows had a safe live quantity and an explicit or reviewed component SKU mapping.");
        }

        const parsed=resultBlock(`Parsed ${resolved.items.length} component SKU${resolved.items.length===1?"":"s"}`,"ok");
        appendLines(parsed,resolved.items.map(item=>`${item.sku} × ${item.qty}`));
        output.appendChild(parsed);
        const populatedQuickQuote=setQuickQuoteText(resolved.items);
        const copyText=resolved.items.map(item=>`${item.sku} × ${item.qty}`).join("\n");
        const copyLabel="Copy parsed SKUs";
        const copy=el("button",{type:"button",text:copyLabel,style:`width:100%;margin-top:8px;padding:7px;border:1px solid ${colors.blue};border-radius:6px;background:#fff;color:${colors.blue};font-size:11px;font-weight:700;cursor:pointer;`});
        copy.addEventListener("click",async()=>{
          try{await navigator.clipboard.writeText(copyText);copy.textContent="✓ Copied";setTimeout(()=>{copy.textContent=copyLabel},1500)}
          catch{copy.textContent="Copy failed"}
        });
        output.appendChild(copy);
        setBusy(false,`Finished. Parsed ${resolved.items.length} component SKU${resolved.items.length===1?"":"s"} with quantities.${populatedQuickQuote?"":" Quick Quote was not populated on this surface."}`);
      }catch(error){
        renderError(error?.message||String(error));
        setBusy(false,"No cart, Gmail, or CRM state was changed.");
      }
    });

    refreshEligibility();
    if(isSidebar&&chrome.tabs?.onActivated&&chrome.tabs?.onUpdated){
      chrome.tabs.onActivated.addListener(()=>refreshEligibility());
      chrome.tabs.onUpdated.addListener((_tabId,changeInfo,tab)=>{
        if(tab?.active&&(changeInfo.url||changeInfo.status==="complete"))refreshEligibility();
      });
    }
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
  else mount();
})();
