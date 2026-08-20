/* Stratus local patch: post-send Task only / Snooze only / Snooze + Task choices. */
(()=>{"use strict";
const PATCH_KEY="__stratusGmailSendTaskChoicesV2";
if(window[PATCH_KEY])return;
Object.defineProperty(window,PATCH_KEY,{value:true});

const RECENT_SEND_MS=60000;
const popupState=new WeakMap();
let pendingSend=null;
let confirmedSend=null;

function text(value){return String(value||"").replace(/\s+/g," ").trim()}
function visible(el){
  if(!el||el.nodeType!==1||el.closest('[aria-hidden="true"]'))return false;
  const style=window.getComputedStyle(el);
  if(style.display==="none"||style.visibility==="hidden")return false;
  const rect=el.getBoundingClientRect();
  return rect.width>0&&rect.height>0;
}
function currentConversation(){
  const ids=[...new Set([...document.querySelectorAll("[data-thread-perm-id]")]
    .filter(visible).map(el=>text(el.getAttribute("data-thread-perm-id"))).filter(Boolean))];
  if(ids.length!==1)return{ok:false,reason:ids.length?"more than one Gmail conversation is visible":"no Gmail conversation is visible"};
  const subjects=[...new Set([...document.querySelectorAll("h2.hP,h2[data-thread-perm-id],[data-thread-perm-id] h2")]
    .filter(visible).map(el=>text(el.textContent)).filter(Boolean))];
  if(subjects.length!==1)return{ok:false,reason:subjects.length?"the visible conversation subject is ambiguous":"the visible conversation subject is unavailable"};
  const hash=window.location.hash||"";
  if(!/\/[A-Za-z0-9_-]+(?:\?.*)?$/.test(hash))return{ok:false,reason:"the Gmail conversation URL is not stable"};
  return{ok:true,permId:ids[0],subject:subjects[0],hash};
}
function sameConversation(a,b){
  return!!(a&&b&&a.ok&&b.ok&&a.permId===b.permId&&a.subject===b.subject&&a.hash===b.hash);
}
function conversationStillPresent(expected){
  return sameConversation(expected,currentConversation());
}
function addBusinessDays(days,start=new Date){
  const result=new Date(start.getTime());
  let added=0;
  while(added<days){
    result.setDate(result.getDate()+1);
    if(result.getDay()!==0&&result.getDay()!==6)added++;
  }
  return result;
}
function localIsoDate(date){
  const year=date.getFullYear();
  const month=String(date.getMonth()+1).padStart(2,"0");
  const day=String(date.getDate()).padStart(2,"0");
  return`${year}-${month}-${day}`;
}
function localDateFromIso(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return null;
  const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]),12,0,0,0);
  return localIsoDate(date)===value?date:null;
}
function defaultSnoozeIso(){return localIsoDate(addBusinessDays(3))}
function futureSnoozeDate(date,now=new Date){
  if(!(date instanceof Date)||Number.isNaN(date.getTime()))return false;
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12,0,0,0);
  return date.getTime()>today.getTime();
}
function taskOutcome(status){
  const value=text(status);
  if(value==="✓ Task completed. Follow-up created."||/^✓ Due date moved to \d{4}-\d{2}-\d{2}$/.test(value)||/^✓ Task created!/.test(value)){
    return{state:"success",message:value};
  }
  if(/^Error:\s*/i.test(value))return{state:"failure",message:value};
  return null;
}
function snoozeTargetForTaskAction(button,popup){
  const fallback=defaultSnoozeIso();
  if(!button?.classList?.contains?.("stp-create"))return fallback;
  const due=popup?.querySelector?.(".stp-due");
  return due?.value||due?.defaultValue||due?.getAttribute?.("value")||fallback;
}
function movedDueDate(outcome){
  const match=outcome?.state==="success"&&outcome.message?.match?.(/^✓ Due date moved to (\d{4}-\d{2}-\d{2})$/);
  return match?match[1]:null;
}
function positiveMessageSent(value){
  const normalized=text(value).toLowerCase();
  if(/\b(?:not|never|failed|failure|unable|could not|cannot|can't|was not|wasn't)\b/.test(normalized))return false;
  return/^message sent(?:\b|[.!])/.test(normalized);
}
function positiveSnoozeConfirmation(value){
  const normalized=text(value).toLowerCase();
  if(/\b(?:not|never|failed|failure|unable|could not|cannot|can't|was not|wasn't)\b/.test(normalized))return false;
  return/^(?:conversation\s+)?snoozed(?:\b|[.!])/.test(normalized);
}
function exactSnoozeConfirmation(value,target){
  if(!positiveSnoozeConfirmation(value)||!(target instanceof Date)||Number.isNaN(target.getTime()))return false;
  const notice=compactDateText(value);
  const years=String(value||"").match(/\b(?:19|20)\d{2}\b/g)||[];
  if(years.length&&years.some(year=>Number(year)!==target.getFullYear()))return false;
  const labels=[...dateLabels(target)].filter(label=>years.length?/\b(?:19|20)\d{2}\b/.test(label):!/\b(?:19|20)\d{2}\b/.test(label));
  return labels.some(label=>notice.includes(compactDateText(label)));
}

if(globalThis.__STRATUS_SNOOZE_TEST__===true){
  globalThis.__STRATUS_SNOOZE_TEST_HOOKS__={
    addBusinessDays,localIsoDate,localDateFromIso,defaultSnoozeIso,futureSnoozeDate,snoozeTargetForTaskAction,movedDueDate,sameConversation,taskOutcome,positiveMessageSent,positiveSnoozeConfirmation,exactSnoozeConfirmation,
    exactSnoozedRowState,verifyExactSnoozedRow,postSnoozeTransitionState,outcomeText
  };
  return;
}

function showSnoozeStatus(message,isError=false,uncertain=false,sticky=false){
  document.querySelector(".stratus-snooze-result")?.remove();
  const toast=document.createElement("div");
  toast.className="stratus-snooze-result";
  toast.setAttribute("role",isError?"alert":"status");
  toast.setAttribute("aria-live",isError?"assertive":"polite");
  toast.style.cssText=`position:fixed;top:16px;right:16px;z-index:2147483647;max-width:360px;padding:12px 14px;border-radius:9px;border:1px solid ${isError?"#f1aeb5":"#a8dab5"};background:${isError?"#fce8e6":"#e6f4ea"};color:${isError?"#b3261e":"#137333"};box-shadow:0 4px 18px rgba(0,0,0,.18);font:12px/1.4 -apple-system,BlinkMacSystemFont,'Google Sans',sans-serif;`;
  const body=document.createElement("span");
  body.textContent=message;
  toast.appendChild(body);
  if(sticky){
    const close=document.createElement("button");
    close.type="button";
    close.setAttribute("aria-label","Dismiss Stratus workflow summary");
    close.textContent="×";
    close.style.cssText="float:right;margin:-4px -5px -4px 10px;padding:0 4px;border:0;background:transparent;color:inherit;font:700 18px/1 sans-serif;cursor:pointer;";
    close.addEventListener("click",()=>toast.remove());
    toast.insertBefore(close,body);
  }
  document.body.appendChild(toast);
  if(!sticky)setTimeout(()=>toast.remove(),uncertain?20000:(isError?15000:9000));
}
function accessibleName(el){
  return text(el?.getAttribute?.("aria-label")||el?.getAttribute?.("data-tooltip")||el?.getAttribute?.("title")||el?.textContent).toLowerCase();
}
function clickable(el){return el?.closest?.('button,[role="button"],[role="menuitem"],[role="option"],[role="gridcell"],.J-N')||el}
function uniqueVisible(elements){
  return[...new Set(elements.map(clickable).filter(el=>el&&visible(el)&&!el.disabled&&el.getAttribute("aria-disabled")!=="true"))];
}
function activateNativeControl(el,label){
  if(!el||!visible(el)||el.disabled||el.getAttribute("aria-disabled")==="true"){
    throw new Error(`${label} is no longer safely available`);
  }
  const rect=el.getBoundingClientRect();
  const clientX=rect.left+rect.width/2;
  const clientY=rect.top+rect.height/2;
  for(const[type,buttons]of[["pointerdown",1],["mousedown",1],["pointerup",0],["mouseup",0],["click",0]]){
    const init={bubbles:true,cancelable:true,composed:true,view:window,button:0,buttons,clientX,clientY};
    const event=type.startsWith("pointer")
      ?new PointerEvent(type,{...init,pointerId:1,pointerType:"mouse",isPrimary:true})
      :new MouseEvent(type,init);
    el.dispatchEvent(event);
  }
}
function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function waitForUnique(find,timeoutMs,label){
  const deadline=Date.now()+timeoutMs;
  let last=[];
  do{
    last=uniqueVisible(find());
    if(last.length===1)return last[0];
    await wait(100);
  }while(Date.now()<deadline);
  throw new Error(last.length>1?`${label} is ambiguous`:`${label} could not be reached`);
}
function pressEscape(){
  const init={key:"Escape",code:"Escape",keyCode:27,which:27,bubbles:true,cancelable:true};
  (document.activeElement||document).dispatchEvent(new KeyboardEvent("keydown",init));
  (document.activeElement||document).dispatchEvent(new KeyboardEvent("keyup",init));
}
function exactButtons(scope,label){
  return[...scope.querySelectorAll('button,[role="button"],[role="menuitem"]')]
    .filter(el=>accessibleName(el)===label.toLowerCase());
}
function belongsToConversationToolbar(el){
  const button=clickable(el);
  let ancestor=button?.parentElement;
  for(let depth=0;ancestor&&depth<8;depth++,ancestor=ancestor.parentElement){
    const rect=ancestor.getBoundingClientRect();
    const toolbarSized=ancestor!==document.body&&ancestor!==document.documentElement&&
      rect.width>0&&rect.height>0&&rect.height<=180;
    if(!toolbarSized)continue;
    const exactUnique=label=>uniqueVisible([...ancestor.querySelectorAll('button,[role="button"],[aria-label],[data-tooltip],[title]')]
      .filter(control=>accessibleName(control)===label.toLowerCase()));
    const snooze=exactUnique("Snooze");
    if(snooze.length!==1||snooze[0]!==button)continue;
    const back=uniqueVisible([...ancestor.querySelectorAll('button,[role="button"],[aria-label],[data-tooltip],[title]')]
      .filter(control=>["back to inbox","back to search results"].includes(accessibleName(control))));
    if(back.length!==1||exactUnique("Archive").length!==1||exactUnique("Delete").length!==1)continue;
    const supporting=["Report spam","Mark as unread","Add to Tasks"]
      .filter(label=>exactUnique(label).length===1).length;
    if(supporting>=2)return true;
  }
  return false;
}
function dateLabels(date){
  const labels=new Set;
  for(const locale of[undefined,"en-US","en-GB"]){
    for(const options of[
      {weekday:"long",month:"long",day:"numeric",year:"numeric"},
      {month:"long",day:"numeric",year:"numeric"},
      {weekday:"short",month:"short",day:"numeric",year:"numeric"},
      {month:"short",day:"numeric",year:"numeric"},
      {weekday:"long",month:"long",day:"numeric"},
      {month:"long",day:"numeric"},
      {weekday:"short",month:"short",day:"numeric"},
      {month:"short",day:"numeric"},
      {day:"numeric",month:"short"}
    ])labels.add(text(new Intl.DateTimeFormat(locale,options).format(date)).toLowerCase());
  }
  return labels;
}
function normalizedDateLabel(el){
  return accessibleName(el).replace(/,?\s+(selected|today)$/i,"");
}
function dateFields(dialog){
  return uniqueVisible([...dialog.querySelectorAll('input')]
    .filter(el=>el.type==="date"||accessibleName(el)==="date"));
}
function dateValueMatches(input,target,iso){
  const value=text(input.value).toLowerCase();
  return value===iso||dateLabels(target).has(value);
}
function setDateInput(input,iso){
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
  if(!setter)throw new Error("Gmail's native date field cannot be controlled safely");
  setter.call(input,iso);
  input.dispatchEvent(new Event("input",{bubbles:true}));
  input.dispatchEvent(new Event("change",{bubbles:true}));
  if(input.value!==iso)throw new Error("Gmail did not accept the selected snooze date");
}
function snoozeDialogLooksValid(dialog,target){
  const signature=(accessibleName(dialog)+" "+text(dialog.textContent)).toLowerCase();
  const identifiesDateAndTime=/\b(?:pick|select|choose)?\s*date\s*(?:&|and)\s*time\b/.test(signature)
    ||(/\bsnooze\b/.test(signature)&&/\bdate\b/.test(signature)&&/\btime\b/.test(signature));
  if(!identifiesDateAndTime)return false;
  const dateInputs=dateFields(dialog);
  if(dateInputs.length>1)return false;
  const allowed=dateLabels(target);
  const targetCells=uniqueVisible([...dialog.querySelectorAll('[role="gridcell"],[role="button"][aria-label],td[aria-label]')]
    .filter(el=>allowed.has(normalizedDateLabel(el))));
  return dateInputs.length===1||targetCells.length===1;
}
function inferredDateDialogs(target){
  const roots=[];
  const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(el=>accessibleName(el)==="pick date & time"||accessibleName(el)==="pick date and time");
  for(const heading of headings){
    let candidate=heading.parentElement;
    for(let depth=0;candidate&&depth<6;depth++,candidate=candidate.parentElement){
      const rect=candidate.getBoundingClientRect();
      const bounded=candidate!==document.body&&candidate!==document.documentElement&&
        rect.width>0&&rect.height>0&&
        rect.width<=Math.min(900,window.innerWidth*.9)&&rect.height<=Math.min(900,window.innerHeight*.9);
      if(!bounded)continue;
      if(uniqueVisible(exactButtons(candidate,"Save")).length===1&&
          uniqueVisible(exactButtons(candidate,"Cancel")).length===1&&
          snoozeDialogLooksValid(candidate,target)){
        roots.push(candidate);
        break;
      }
    }
  }
  return[...new Set(roots)];
}
async function findDateDialog(existingDialogs,existingInferred,target){
  return waitForUnique(()=>{
    const explicit=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.Kj-JD')].filter(dialog=>{
      if(existingDialogs.has(dialog))return false;
      const save=uniqueVisible(exactButtons(dialog,"Save"));
      const cancel=uniqueVisible(exactButtons(dialog,"Cancel"));
      return visible(dialog)&&save.length===1&&cancel.length===1&&snoozeDialogLooksValid(dialog,target);
    });
    return explicit.length?explicit:inferredDateDialogs(target).filter(dialog=>!existingInferred.has(dialog));
  },2500,"Gmail's native date-and-time dialog");
}
function cancelDialog(dialog){
  const cancel=uniqueVisible(exactButtons(dialog,"Cancel"));
  if(cancel.length===1){
    try{activateNativeControl(cancel[0],"Gmail's Cancel action")}catch{pressEscape()}
  }else pressEscape();
}
function liveNoticeSnapshot(){
  return new Map(uniqueVisible([...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')])
    .map(el=>[el,text(el.textContent)]));
}
async function waitForSnoozeConfirmation(before,target,timeoutMs=3500){
  const deadline=Date.now()+Math.max(0,Math.min(timeoutMs,3500));
  do{
    const notices=uniqueVisible([...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')]);
    if(notices.some(el=>{
      const value=text(el.textContent);
      return exactSnoozeConfirmation(value,target)&&(!before.has(el)||before.get(el)!==value);
    }))return true;
    await wait(100);
  }while(Date.now()<deadline);
  return false;
}
function normalizedThreadToken(value){
  return text(value).replace(/^#/,"");
}
function compactDateText(value){
  return text(value).toLowerCase().replace(/[^a-z0-9]/g,"");
}
function elementEvidence(el){
  return[el?.textContent,el?.getAttribute?.("aria-label"),el?.getAttribute?.("title"),el?.getAttribute?.("data-tooltip")]
    .map(text).filter(Boolean);
}
function exactSubjectEvidence(row,subject){
  return[row,...row.querySelectorAll("*")].some(el=>{
    if(el!==row&&!visible(el))return false;
    return elementEvidence(el).some(value=>value===subject);
  });
}
function exactSnoozedDateEvidence(row,target){
  const allowed=new Set([...dateLabels(target)].map(label=>`snoozeduntil${compactDateText(label)}`));
  for(const el of[row,...row.querySelectorAll("*")]){
    if(el!==row&&!visible(el))continue;
    const nativeMetadata=[el.getAttribute?.("aria-label"),el.getAttribute?.("title"),el.getAttribute?.("data-tooltip")]
      .map(text).filter(Boolean);
    if(nativeMetadata.some(value=>allowed.has(compactDateText(value))))return true;
    if(el.matches?.('[role="gridcell"],[role="cell"]')&&allowed.has(compactDateText(el.textContent)))return true;
  }
  return false;
}
function exactSnoozedRowState(expected,target){
  const hash=window.location.hash||"";
  const parentHash=String(expected?.hash||"").replace(/\/[A-Za-z0-9_-]+(?:\?.*)?$/,"");
  if(hash!==parentHash&&hash!=="#snoozed")return{state:"route-mismatch"};
  const token=normalizedThreadToken(expected?.permId);
  const subject=text(expected?.subject);
  if(!token||!subject)return{state:"identity-unavailable"};
  const rows=[...new Set([...document.querySelectorAll("[data-thread-id]")]
    .filter(identity=>normalizedThreadToken(identity.getAttribute("data-thread-id"))===token)
    .map(identity=>identity.closest('tr[role="row"],[role="row"]'))
    .filter(row=>row&&visible(row)))];
  if(rows.length>1)return{state:"ambiguous"};
  if(rows.length===0)return{state:"not-ready"};
  const row=rows[0];
  const identities=[...(row.matches?.("[data-thread-id]")?[row]:[]),...row.querySelectorAll("[data-thread-id]")]
    .filter(visible);
  if(identities.length===0)return{state:"not-ready"};
  if(!identities.every(identity=>normalizedThreadToken(identity.getAttribute("data-thread-id"))===token))return{state:"ambiguous"};
  if(!exactSubjectEvidence(row,subject))return{state:"not-ready"};
  return{state:exactSnoozedDateEvidence(row,target)?"match":"not-ready"};
}
async function verifyExactSnoozedRow(expected,target,timeoutMs=7000){
  if(!normalizedThreadToken(expected?.permId)||!text(expected?.subject))return false;
  const deadline=Date.now()+Math.max(0,Math.min(timeoutMs,7000));
  do{
    const result=exactSnoozedRowState(expected,target);
    if(result.state==="match")return true;
    if(result.state==="ambiguous"||result.state==="identity-unavailable")return false;
    await wait(100);
  }while(Date.now()<deadline);
  return false;
}
async function waitForSelectedDate(dialog,target,iso){
  const deadline=Date.now()+1200;
  const allowed=dateLabels(target);
  do{
    const dateInputs=dateFields(dialog);
    if(dateInputs.length===1&&dateValueMatches(dateInputs[0],target,iso))return true;
    const selected=uniqueVisible([...dialog.querySelectorAll('[aria-selected="true"][aria-label]')]
      .filter(el=>allowed.has(normalizedDateLabel(el))));
    if(selected.length===1)return true;
    await wait(75);
  }while(Date.now()<deadline);
  return false;
}
function postSnoozeTransitionState(expected,current,hash){
  if(sameConversation(expected,current))return"same";
  if(current?.ok)return"changed";
  if(hash&&expected?.hash&&hash!==expected.hash)return"departed";
  return"not-ready";
}
async function waitForPostSnoozeTransition(expected,timeoutMs=1600){
  const deadline=Date.now()+Math.max(0,Math.min(timeoutMs,1600));
  do{
    const state=postSnoozeTransitionState(expected,currentConversation(),window.location.hash||"");
    if(state==="departed"||state==="changed")return state;
    await wait(100);
  }while(Date.now()<deadline);
  return postSnoozeTransitionState(expected,currentConversation(),window.location.hash||"");
}
async function waitForPostSaveVerification(before,expected,target,timeoutMs=4500){
  const deadline=Date.now()+Math.max(0,Math.min(timeoutMs,4500));
  let sawExactNotice=false;
  do{
    const notices=uniqueVisible([...document.querySelectorAll('[role="alert"],[role="status"],[aria-live="polite"],[aria-live="assertive"]')]);
    if(notices.some(el=>{
      const value=text(el.textContent);
      return exactSnoozeConfirmation(value,target)&&(!before.has(el)||before.get(el)!==value);
    }))sawExactNotice=true;
    const transition=postSnoozeTransitionState(expected,currentConversation(),window.location.hash||"");
    if(transition==="changed")return{state:"changed"};
    if(transition==="departed"){
      if(exactSnoozedRowState(expected,target).state==="match")return{state:"verified",evidence:"exact Gmail row"};
      if(sawExactNotice)return{state:"verified",evidence:"dated Gmail notice and conversation departure"};
    }
    await wait(100);
  }while(Date.now()<deadline);
  return{state:"not-verified",transition:postSnoozeTransitionState(expected,currentConversation(),window.location.hash||""),sawExactNotice};
}
async function performNativeSnoozeAttempt(expected,target,iso){
  const now=currentConversation();
  if(!sameConversation(expected,now))throw new Error(`conversation identity changed (${now.reason||"mismatch"})`);

  const snoozeButton=await waitForUnique(()=>[...document.querySelectorAll('[aria-label],[data-tooltip],[title]')]
    .filter(el=>accessibleName(el)==="snooze"&&clickable(el)?.matches('button,[role="button"]')&&
      !el.closest('[class*="stratus-"]')&&el.closest('[role="toolbar"],.G-tF,[gh="mtb"]')&&belongsToConversationToolbar(el)),
    1200,"Gmail's native Snooze button");
  if(!sameConversation(expected,currentConversation()))throw new Error("conversation identity changed before opening Snooze");
  const pickLabels=new Set(["pick date & time","pick date and time","select date & time","select date and time","choose date & time","choose date and time"]);
  const findPickOptions=()=>[...document.querySelectorAll('[role="menuitem"],[role="option"],[role="button"],.J-N,[aria-label]')]
    .filter(el=>pickLabels.has(accessibleName(el))&&el.closest('[role="menu"],[role="listbox"],.J-M'));
  const pickOptionsBefore=new Set(uniqueVisible(findPickOptions()));
  activateNativeControl(snoozeButton,"Gmail's native Snooze button");

  let pick;
  try{
    pick=await waitForUnique(()=>findPickOptions().filter(el=>!pickOptionsBefore.has(clickable(el))),1800,"Gmail's Pick date & time option");
  }catch(error){pressEscape();throw error}
  if(!sameConversation(expected,currentConversation())){pressEscape();throw new Error("conversation identity changed while opening Snooze")}
  const dialogsBefore=new Set([...document.querySelectorAll('[role="dialog"],[aria-modal="true"],.Kj-JD')]);
  const inferredDialogsBefore=new Set(inferredDateDialogs(target));
  activateNativeControl(pick,"Gmail's Pick date & time option");

  let dialog;
  try{dialog=await findDateDialog(dialogsBefore,inferredDialogsBefore,target)}catch(error){pressEscape();throw error}
  if(!conversationStillPresent(expected)){cancelDialog(dialog);throw new Error("conversation identity became ambiguous in Gmail's date picker")}

  let confirmationsBefore;
  try{
    const dateInputs=dateFields(dialog);
    if(dateInputs.length>1)throw new Error("Gmail's native date field is ambiguous");
    if(dateInputs.length===1&&dateInputs[0].type==="date"){
      setDateInput(dateInputs[0],iso);
    }else{
      const allowed=dateLabels(target);
      const cells=uniqueVisible([...dialog.querySelectorAll('[role="gridcell"],[role="button"][aria-label],td[aria-label]')]
        .filter(el=>allowed.has(normalizedDateLabel(el))));
      if(cells.length!==1)throw new Error(cells.length?"the selected snooze date is ambiguous":"the selected snooze date is not available in Gmail's picker");
      activateNativeControl(cells[0],"Gmail's selected snooze date");
    }
    if(!await waitForSelectedDate(dialog,target,iso))throw new Error("Gmail did not positively confirm the selected snooze date");

    if(!conversationStillPresent(expected))throw new Error("conversation identity changed before saving the snooze");
    const save=uniqueVisible(exactButtons(dialog,"Save"));
    if(save.length!==1)throw new Error(save.length?"Gmail's Save action is ambiguous":"Gmail's Save action is unavailable");
    confirmationsBefore=liveNoticeSnapshot();
    activateNativeControl(save[0],"Gmail's Save action");
  }catch(error){cancelDialog(dialog);throw error}
  return waitForPostSaveVerification(confirmationsBefore,expected,target);
}
async function snoozeConversation(expected,targetIso=null){
  const iso=targetIso||defaultSnoozeIso();
  const target=localDateFromIso(iso);
  if(!target)throw new Error("the selected snooze date is invalid");
  if(!futureSnoozeDate(target))throw new Error("the task due date must be after today to use it for Gmail Snooze");
  for(let attempt=1;attempt<=2;attempt++){
    const result=await performNativeSnoozeAttempt(expected,target,iso);
    if(result.state==="verified")return target;
    if(result.state==="changed"){
      const error=new Error("Gmail changed to a different conversation before the snooze result could be verified");
      error.uncertain=true;
      throw error;
    }
    if(result.transition==="same"&&attempt===1&&sameConversation(expected,currentConversation())){
      await wait(150);
      continue;
    }
    const error=new Error(result.transition==="departed"
      ?"Gmail moved the conversation, but the exact snoozed-until evidence was not available"
      :"the exact conversation did not leave the current view after Gmail Snooze");
    error.uncertain=true;
    throw error;
  }
}

function modeNeedsTask(mode){return mode==="task-only"||mode==="snooze-task"}
function modeNeedsSnooze(mode){return mode==="snooze-only"||mode==="snooze-task"}
function outcomeText(label,outcome){
  if(!outcome||outcome.state==="not-requested")return`${label}: not requested`;
  if(outcome.state==="pending")return`${label}: pending — ${outcome.message}`;
  if(outcome.state==="success")return`${label}: succeeded — ${outcome.message}`;
  if(outcome.state==="uncertain")return`${label}: outcome could not be verified — ${outcome.message}`;
  return`${label}: failed — ${outcome.message}`;
}
function publishWorkflowStatus(state){
  if(!state||state.mode==="task-only")return;
  const parts=["Send: confirmed"];
  parts.push(outcomeText("Task",state.taskOutcome));
  parts.push(outcomeText("Snooze",state.snoozeOutcome));
  const outcomes=[state.taskOutcome,state.snoozeOutcome].filter(Boolean);
  const uncertain=outcomes.some(outcome=>outcome.state==="uncertain");
  const failed=outcomes.some(outcome=>outcome.state==="failure");
  showSnoozeStatus(parts.join(" | "),failed||uncertain,uncertain,false);
}
function lockChoiceControls(state){
  state.executionStarted=true;
  Object.values(state.modeInputs||{}).forEach(input=>{input.disabled=true});
  if(state.snoozeOnlyButton)state.snoozeOnlyButton.disabled=true;
}
async function runSnoozeForState(state){
  if(state.snoozeStarted)return;
  state.snoozeStarted=true;
  state.snoozeOutcome={state:"pending",message:"opening Gmail's native snooze picker"};
  publishWorkflowStatus(state);
  try{
    const target=await snoozeConversation(state.expected,state.snoozeTargetIso||null);
    const label=new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(target);
    state.snoozeOutcome={state:"success",message:`Snoozed until ${label}.`};
  }catch(error){
    state.snoozeOutcome=error.uncertain
      ?{state:"uncertain",message:`${error.message}. Check the conversation before retrying.`}
      :{state:"failure",message:error.message||"native Gmail snooze failed"};
  }
  publishWorkflowStatus(state);
}
function applyModeControls(state){
  if(!state)return;
  const snoozeOnly=state.mode==="snooze-only";
  state.taskButtons.forEach(button=>{button.hidden=snoozeOnly});
  state.snoozeOnlyButton.hidden=!snoozeOnly;
  state.snoozeOnlyButton.disabled=state.executionStarted||!state.snoozeReady;
  if(state.modeInputs["snooze-only"]&&!state.modeInputs["snooze-only"].checked){
    state.modeInputs["snooze-only"].disabled=state.executionStarted||!state.snoozeReady;
  }
  if(state.modeInputs["snooze-task"]&&!state.modeInputs["snooze-task"].checked){
    state.modeInputs["snooze-task"].disabled=state.executionStarted||!state.snoozeReady;
  }
}
function setMode(state,mode){
  if(state.executionStarted)return;
  state.mode=mode;
  applyModeControls(state);
  state.note.style.color=modeNeedsSnooze(mode)&&!state.snoozeReady?"#b3261e":"#5f6368";
  if(!modeNeedsSnooze(mode)){
    state.note.textContent="Snooze is off. The existing Zoho task behavior is unchanged.";
  }else if(!state.snoozeReady){
    state.note.textContent="Snooze is unavailable because the sent Gmail conversation is not confirmed. Task only remains available.";
  }else if(mode==="snooze-task"&&state.popup.querySelector(".stp-due")){
    state.note.textContent="Snooze will use the Create Task due date shown below, including a manual adjustment. Gmail must confirm the exact conversation and date.";
  }else if(mode==="snooze-task"){
    state.note.textContent="Extend: Snooze uses the exact successful due date. Complete + Follow-Up does not report its due date, so Snooze uses its own 3-business-day default.";
  }else{
    state.note.textContent="Snooze uses the 3-business-day default. Gmail must confirm the exact conversation and date.";
  }
}
function wireTaskActions(popup,state){
  for(const button of state.taskButtons){
    button.addEventListener("click",event=>{
      if(state.executionStarted)return;
      if(state.mode==="snooze-task"&&!state.snoozeReady){
        event.preventDefault();
        event.stopImmediatePropagation();
        state.taskOutcome={state:"not-requested",message:"task action was not started"};
        state.snoozeOutcome={state:"failure",message:"the sent Gmail conversation is not yet confirmed; choose Task only or wait for send confirmation"};
        publishWorkflowStatus(state);
        return;
      }
      lockChoiceControls(state);
      if(state.mode==="task-only")return;
      if(state.mode!=="snooze-task")return;
      state.snoozeTargetIso=snoozeTargetForTaskAction(button,popup);
      state.taskOutcome={state:"pending",message:button.classList.contains("stp-create")?"Create Task is running":"the selected existing-task action is running"};
      state.snoozeOutcome={state:"pending",message:"waiting for the task attempt to finish so its Gmail URL stays intact"};
      publishWorkflowStatus(state);
    },true);
  }
  const status=popup.querySelector(".stp-status");
  if(!status)return;
  const check=()=>{
    if(!state.executionStarted||state.mode!=="snooze-task")return;
    const outcome=taskOutcome(status.textContent);
    if(!outcome)return;
    state.taskOutcome=outcome;
    const moved=movedDueDate(outcome);
    if(moved)state.snoozeTargetIso=moved;
    if(!state.snoozeStarted)runSnoozeForState(state);
    publishWorkflowStatus(state);
  };
  new MutationObserver(check).observe(status,{childList:true,subtree:true,characterData:true});
  check();
}
function makeModeChoice(state,value,labelText,checked=false){
  const label=document.createElement("label");
  label.style.cssText="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;";
  const input=document.createElement("input");
  input.type="radio";
  input.name=`stratus-post-send-mode-${state.id}`;
  input.value=value;
  input.checked=checked;
  input.style.cssText="margin:0;accent-color:#1a73e8;";
  const textNode=document.createElement("span");
  textNode.textContent=labelText;
  label.append(input,textNode);
  input.addEventListener("change",()=>{if(input.checked)setMode(state,value)});
  state.modeInputs[value]=input;
  return label;
}
function installOptIn(popup){
  if(popup.dataset.stratusPostSendChoicesInstalled)return;
  const taskButtons=[...popup.querySelectorAll(".stp-complete,.stp-extend,.stp-create")];
  if(!taskButtons.length)return;
  const actionBox=taskButtons[0].parentElement;
  if(!actionBox)return;
  popup.dataset.stratusPostSendChoicesInstalled="true";

  const state={
    id:String(Date.now())+Math.random().toString(36).slice(2),popup,taskButtons,mode:"snooze-task",
    modeInputs:{},note:null,snoozeOnlyButton:null,expected:null,confirmation:null,snoozeReady:false,
    executionStarted:false,snoozeStarted:false,snoozeTargetIso:null,
    taskOutcome:{state:"not-requested",message:""},snoozeOutcome:{state:"not-requested",message:""},
  };
  const group=document.createElement("div");
  group.className="stratus-post-send-choices";
  group.setAttribute("role","radiogroup");
  group.setAttribute("aria-label","Choose what happens after send");
  group.style.cssText="padding:8px 9px;border:1px solid #dadce0;border-radius:7px;background:#f8f9fa;color:#202124;font-size:11px;line-height:1.35;";
  const heading=document.createElement("div");
  heading.textContent="After send — choose one:";
  heading.style.cssText="font-weight:700;margin-bottom:3px;";
  group.append(
    heading,
    makeModeChoice(state,"snooze-only","Snooze only — no Zoho task",false),
    makeModeChoice(state,"task-only","Task only — do not snooze",false),
    makeModeChoice(state,"snooze-task","Snooze + Task — use the task date when available",true),
  );

  const snoozeOnlyButton=document.createElement("button");
  snoozeOnlyButton.type="button";
  snoozeOnlyButton.className="stratus-snooze-only-action";
  snoozeOnlyButton.textContent="Snooze conversation for 3 business days";
  snoozeOnlyButton.style.cssText="padding:9px 14px;background:#1a73e8;color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;text-align:left;";
  snoozeOnlyButton.addEventListener("click",()=>{
    if(state.executionStarted||state.mode!=="snooze-only")return;
    const current=currentConversation();
    if(!state.snoozeReady||!sameConversation(state.expected,current)){
      state.taskOutcome={state:"not-requested",message:""};
      state.snoozeOutcome={state:"failure",message:`conversation identity is not confirmed (${current.reason||"mismatch"})`};
      publishWorkflowStatus(state);
      return;
    }
    lockChoiceControls(state);
    state.taskOutcome={state:"not-requested",message:""};
    runSnoozeForState(state);
  });

  const note=document.createElement("div");
  note.className="stratus-snooze-readiness";
  note.style.cssText="font-size:10px;line-height:1.35;color:#5f6368;";
  const choiceBox=document.createElement("div");
  choiceBox.className="stratus-post-send-choice-box";
  choiceBox.style.cssText="display:flex;flex-direction:column;gap:7px;margin-bottom:9px;";
  choiceBox.append(group,snoozeOnlyButton,note);
  if(popup.querySelector(".stp-create")){
    const includeEmail=document.createElement("label");
    includeEmail.className="stratus-task-email-optin";
    includeEmail.style.cssText="display:flex;align-items:flex-start;gap:6px;padding:6px 8px;border:1px solid #dadce0;border-radius:7px;background:#fff;color:#5f6368;font-size:10px;line-height:1.35;cursor:pointer;";
    const includeEmailInput=document.createElement("input");
    includeEmailInput.type="checkbox";
    includeEmailInput.style.cssText="margin:1px 0 0;accent-color:#1a73e8;";
    const includeEmailText=document.createElement("span");
    includeEmailText.textContent="Include this Gmail conversation link in the new task (optional)";
    includeEmail.append(includeEmailInput,includeEmailText);
    choiceBox.append(includeEmail);
  }
  state.note=note;
  state.snoozeOnlyButton=snoozeOnlyButton;
  popup.insertBefore(choiceBox,actionBox);
  popupState.set(popup,state);
  refreshPopupReadiness(popup);
  setMode(state,"snooze-task");
  wireTaskActions(popup,state);
}
function refreshPopupReadiness(popup){
  const state=popupState.get(popup);
  if(!state||state.executionStarted)return;
  const candidate=state.confirmation||((confirmedSend&&!confirmedSend.consumed)?confirmedSend:null);
  const current=currentConversation();
  const recent=!!(candidate&&Date.now()-candidate.at<=RECENT_SEND_MS);
  const ready=!!(recent&&sameConversation(candidate.conversation,current));
  state.snoozeReady=ready;
  if(ready){
    state.confirmation=candidate;
    state.expected=candidate.conversation;
    candidate.consumed=true;
  }
  applyModeControls(state);
  setMode(state,state.mode);
}
function positiveMessageSentRegions(visibleOnly=false){
  const live='[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]';
  return[...new Set([...document.querySelectorAll(live)]
    .filter(el=>(!visibleOnly||visible(el))&&positiveMessageSent(el.textContent)))];
}
function nativeSendToast(node,before){
  if(!node)return false;
  const element=node.nodeType===1?node:node.parentElement;
  if(!element)return false;
  const live='[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]';
  const candidates=[];
  if(element.matches?.(live))candidates.push(element);
  const closest=element.closest?.(live);
  if(closest)candidates.push(closest);
  element.querySelectorAll?.(live).forEach(el=>candidates.push(el));
  return uniqueVisible(candidates).some(el=>positiveMessageSent(el.textContent)&&!before.has(el));
}
document.addEventListener("click",event=>{
  if(!event.target?.closest?.(".stratus-send-task-btn"))return;
  pendingSend={at:Date.now(),conversation:currentConversation(),messageSentRegionsBefore:new Set(positiveMessageSentRegions())};
  confirmedSend=null;
},true);
const observer=new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes){
    if(pendingSend&&Date.now()-pendingSend.at<=15000&&nativeSendToast(node,pendingSend.messageSentRegionsBefore)){
      const current=currentConversation();
      if(sameConversation(pendingSend.conversation,current)){
        confirmedSend={at:Date.now(),conversation:current,consumed:false};
        document.querySelectorAll(".stratus-send-task-popup").forEach(refreshPopupReadiness);
      }
      pendingSend=null;
    }
    if(node.nodeType!==1)continue;
    if(node.matches?.(".stratus-send-task-popup"))installOptIn(node);
    node.querySelectorAll?.(".stratus-send-task-popup").forEach(installOptIn);
  }
});
observer.observe(document.body,{childList:true,subtree:true});
document.querySelectorAll(".stratus-send-task-popup").forEach(installOptIn);

if(!window.__stratusTaskEmailOptInSendWrapper){
  window.__stratusTaskEmailOptInSendWrapper=true;
  const originalSendMessage=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage=(message,...rest)=>{
    if(message&&typeof message==="object"&&message.type==="CRM_CREATE_TASK"){
      const active=document.activeElement;
      const scope=active?.closest?.(".stratus-send-task-popup");
      const include=!!scope?.querySelector?.(".stratus-task-email-optin input:checked");
      if(!include)message={...message,gmailThreadUrl:""};
    }
    return originalSendMessage(message,...rest);
  };
}
})();
/* End Stratus local Gmail task-snooze patch. */
