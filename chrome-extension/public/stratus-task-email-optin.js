(()=>{
  "use strict";
  if(globalThis.__STRATUS_TASK_EMAIL_OPTIN_V1__)return;
  globalThis.__STRATUS_TASK_EMAIL_OPTIN_V1__=true;

  function includeRequested(){
    const form=document.activeElement?.closest?.("form");
    return!!form?.querySelector?.(".stratus-task-email-optin input:checked");
  }

  const originalSendMessage=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,...rest)=>{
    if(message&&typeof message==="object"&&message.type==="CRM_CREATE_TASK"&&!includeRequested()){
      message={...message,gmailThreadUrl:""};
    }
    return originalSendMessage(message,...rest);
  };

  function createOptIn(form){
    if(form.querySelector(".stratus-task-email-optin"))return;
    const subject=form.querySelector('input[placeholder="Task subject *"]');
    const submit=[...form.querySelectorAll('button[type="submit"]')]
      .find(button=>/^(?:Create Task|Creating\.\.\.)$/.test((button.textContent||"").trim()));
    if(!subject||!submit)return;

    const label=document.createElement("label");
    label.className="stratus-task-email-optin";
    label.style.cssText="display:flex;align-items:flex-start;gap:6px;margin:0 0 8px;padding:7px 8px;border:1px solid #dadce0;border-radius:6px;background:#f8f9fa;color:#5f6368;font-size:10px;line-height:1.35;cursor:pointer;";
    const input=document.createElement("input");
    input.type="checkbox";
    input.style.cssText="margin:1px 0 0;accent-color:#1a73a7;";
    const copy=document.createElement("span");
    copy.textContent="Include the current Gmail conversation link in this task (optional)";
    label.append(input,copy);
    submit.parentElement?.parentElement?.insertBefore(label,submit.parentElement);
  }

  function scan(){document.querySelectorAll("form").forEach(createOptIn)}
  new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
  scan();

  if(globalThis.__STRATUS_TASK_EMAIL_OPTIN_TEST__===true){
    globalThis.__STRATUS_TASK_EMAIL_OPTIN_TEST_HOOKS__={includeRequested,createOptIn};
  }
})();
