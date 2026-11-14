/* Meal Prep Planner: the main app (Plan, Shop, Cook, Settings, storage). Library screens are in library.js. */
"use strict";
const $=s=>document.querySelector(s);
const TABS=[["plan","Plan"],["shop","Shop"],["cook","Cook"],["recipes","Recipes"],["ingredients","Ingredients"],["targets","Targets"],["settings","Settings"]];
let DOCS={}, tab=(location.hash||"").slice(1), ME="", APPV="";
if(!TABS.some(t=>t[0]===tab))tab="plan";
const ui={cookMode:"prep",confirmClear:false,editHome:null,list:false,cat:"all",q:"",open:null,edit:null,servings:6,estOnly:false,mui:null,imp:null,backups:null,link:null,pw:false};

function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2600)}
const jhead={"Content-Type":"application/json"};

/* ---------- storage: every save carries the version it started from; a stale save is refused, not overwritten ---------- */
let conflict=false, pending=0;
function showBanner(html){$("#banner").innerHTML=html?`<div class="banner" role="alert">${html}</div>`:""}
function setConflict(){conflict=true;showBanner(`<span><b>Someone else saved a change</b> while you were editing, so your last change wasn't saved.</span><button class="btn primary" data-act="reload">Reload the latest</button>`)}
async function putDoc(path,data){
  if(conflict)return false;pending++;
  try{const r=await fetch("/api/doc/"+path,{method:"PUT",headers:jhead,body:JSON.stringify({data,version:DOCS[path]?DOCS[path].version:0})});
    if(r.status===409){setConflict();return false}
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();DOCS[path]={data,version:j.version};return true}
  catch(e){toast("Couldn't save: "+(e.message||e));return false}
  finally{pending--}}
async function delDoc(path){try{const r=await fetch("/api/doc/"+path,{method:"DELETE"});if(!r.ok)throw new Error("HTTP "+r.status);delete DOCS[path];return true}catch(e){toast("Couldn't delete: "+(e.message||e));return false}}
async function fetchAll(){const r=await fetch("/api/all");if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
async function reloadAll(){const j=await fetchAll();DOCS=j.docs;ME=j.user;APPV=j.appVersion;conflict=false;showBanner("");loadDocs(DOCS);maybeNewWeek();headerInfo();render()}
function headerInfo(){$("#ver").textContent="v"+APPV;$("#who").textContent=ME&&ME!=="dev"?"Signed in as "+ME:"";$("#status").textContent=Object.keys(MEALS).length?`${Object.keys(MEALS).length} meals`:"No meals yet: add some in Recipes."}

let planTimer=null, planWriting=false, planPending=false;
function savePlan(){reconcile();clearTimeout(planTimer);planTimer=setTimeout(flushPlan,600)}
async function flushPlan(){planTimer=null;if(planWriting){planPending=true;return}planWriting=true;
  const ok=await putDoc("state/plan",planDoc());planWriting=false;if(ok&&planPending){planPending=false;flushPlan()}}
const dirty=()=>planTimer!==null||planWriting||pending>0;
function maybeNewWeek(){const wk=weekKey();
  if(LISTWEEK&&LISTWEEK<wk){const n=Object.keys(EDITS).length+Object.keys(CHECKED).filter(k=>CHECKED[k]).length;SWAPS={};DISMISSED={};EDITS={};CHECKED={};LISTWEEK=wk;savePlan();if(n)setTimeout(()=>toast("New week: last week's ticks and At home amounts were cleared."),800)}
  else if(!LISTWEEK&&DOCS["state/plan"]){LISTWEEK=wk;savePlan()}}

// Pick up the other person's changes without a manual reload, unless something is being typed or saved here
async function poll(){if(document.hidden||conflict)return;
  try{const j=await fetchAll();let changed=[];
    for(const[p,d] of Object.entries(j.docs))if(!DOCS[p]||DOCS[p].version!==d.version)changed.push(p);
    for(const p of Object.keys(DOCS))if(!j.docs[p])changed.push(p);
    if(!changed.length)return;
    const typing=document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if(dirty()||typing||ui.edit||ui.editHome||ui.imp&&ui.imp.text)return;  // try again next time
    DOCS=j.docs;loadDocs(DOCS);headerInfo();render();toast("Updated with the latest changes")}catch(e){}}
setInterval(poll,15000);document.addEventListener("visibilitychange",()=>{if(!document.hidden)poll()});

/* ---------- navigation ---------- */
function renderTabs(){$("#tabs").innerHTML=TABS.map(([k,l])=>`<button role="tab" aria-selected="${k===tab}" data-tabgo="${k}">${l}</button>`).join("")}
function render(){reconcile();renderTabs();const v=$("#view");
  if(tab==="plan")planView(v);else if(tab==="shop")shopView(v);else if(tab==="cook")cookView(v);
  else if(tab==="recipes")recipesView(v);else if(tab==="ingredients")ingView(v);else if(tab==="targets")targetsView(v);else settingsView(v)}
function go(t){tab=t;try{history.replaceState(null,"","#"+t)}catch(_){}render();window.scrollTo({top:0})}

/* ---------- PLAN ---------- */
function portionHTML(b,s,m){if(!CARRY_SLOTS.includes(s)||!m)return"";const sl=PLAN[b][s],c=CARRY[s]||{};const fit=isFreezerFit(m);const out=[];
  const note=t=>`<span class="muted small">${t}</span>`,btn=(a,t,title)=>`<button class="btn tiny" ${a}${title?` title="${title}"`:""}>${t}</button>`;
  if(fit&&!sl.fresh){const pk=`<span class="chip near">cooks ${PACK_SERV} · one ${packG(m)} g pack</span>`;
    if(b==="block1"&&c.spare)out.push(pk+note(c.used?`${plural(c.used,"spare portion goes","spare portions go")} to Block 2 ${s}: freeze ${c.used===1?"it":"them"} on prep day.${c.toFreezer?` ${c.toFreezer} more to freeze or eat as a snack.`:""}`
      :c.zEmpty?`${plural(c.spare,"spare portion","spare portions")}: pick a Block 2 ${s} and ${c.spare===1?"it carries":"they carry"} over.`
      :`${plural(c.spare,"spare portion","spare portions")}: freeze or eat as a snack.${c.blocked?` Block 2 ${s} also uses a freezer pack, so it can't take ${c.spare===1?"it":"them"}.`:""}`));
    if(b==="block2"&&c.extra2)out.push(pk+note(`${plural(c.extra2,"extra portion","extra portions")}: freeze or eat as a snack.`));
    if(b==="block2"&&c.blocked)out.push(note(`Block 1 has ${plural(c.spare,"spare portion","spare portions")}. To use ${c.spare===1?"it":"them"} here, swap this meal or cook it from fresh chicken.`)+btn(`data-rand="${b}|${s}"`,"Swap","Pick a meal that doesn't need a freezer pack"));
    if((b==="block1"&&c.spare)||(b==="block2"&&(c.blocked||c.extra2)))out.push(btn(`data-slotfresh="${b}|${s}|1"`,"Fresh chicken instead","Cook this from fresh chicken: any number of portions"))}
  else if(fit&&sl.fresh)out.push(`<span class="chip">fresh chicken · any number</span>`+btn(`data-slotfresh="${b}|${s}|0"`,"Use a freezer pack"));
  if(b==="block2"&&c.used)out.push(`<span class="chip on">${sl.n?`cook ${sl.n} + ${c.used} from Block 1`:`all ${c.used} from Block 1, nothing to cook`}</span>`+note("Thaw the Block 1 portion in the fridge the night before.")+btn(`data-nocarry="${s}|1"`,"Freeze it instead","Keep Block 1's spare in the freezer and cook the full amount here"));
  if(b==="block2"&&sl.noCarry&&block1Spare(s))out.push(note(`Block 1's ${plural(block1Spare(s),"spare portion goes","spare portions go")} to the freezer.`)+btn(`data-nocarry="${s}|0"`,"Use it here"));
  return out.join("")}
function totalsHTML(b){if(!TARGETS)return"";const p=PLAN[b];const get=s=>macros(PM(p[s].meal));
  const add=(...ts)=>ts.reduce((a,t)=>{for(const k in a)a[k]+=t[k];return a},{kcal:0,p:0,c:0,f:0,fib:0});
  const mains=add(get("breakfast"),get("lunch"),get("dinner"));const kyle=add(mains,get("snack1"),get("snack2"));
  const line=(t,tg)=>`<div class="bars"><span class="${rangeStatus(t.kcal,tg.kcal[0],tg.kcal[1])}">${Math.round(t.kcal)}/${tg.kcal[1]} kcal</span>${["p","c","f"].map(k=>`<span class="${rangeStatus(t[k],tg[k]*.95,tg[k]*1.05)}">${k.toUpperCase()} ${Math.round(t[k])}/${tg[k]}</span>`).join("")}<span class="${t.fib>=tg.fib?"on":"near"}">Fibre ${Math.round(t.fib)}/${tg.fib}</span></div>`;
  return`<div class="totals"><div class="tot"><b>Annie</b>${line(mains,TARGETS.anna)}</div><div class="tot"><b>Kyle</b>${line(kyle,TARGETS.kyle)}</div></div>`}
function useupHTML(){const ings=Object.entries(ING).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
  const chips=USEUP.filter(u=>ING[u.id]).map(u=>{const st=uuStatus(u);const x=ING[u.id];
    const s=st.done?`all used: ${st.names.join(", ")} ✓`:st.names.length?`in ${st.names.join(", ")}${u.amt>0?` (${fmtAmt(st.t,x.unit)} of ${fmtAmt(u.amt,x.unit)})`:""}`:"not in the plan yet";
    return`<span class="row" style="gap:2px;flex-wrap:nowrap"><span class="chip ${st.names.length?"on":"near"}" style="white-space:normal">${esc(x.name)}${u.amt>0?` · ${fmtAmt(u.amt,x.unit)}`:""}: ${esc(s)}</span><button class="icon" data-uudel="${esc(u.id)}" title="Remove from Use up" aria-label="Remove ${esc(x.name)}" style="width:26px;height:26px">×</button></span>`}).join("");
  return`<details class="panel" style="margin-bottom:12px" ${USEUP.length?"open":""}><summary style="cursor:pointer"><b>Use up</b> <span class="muted small">Open packs and leftovers. Suggest favours meals that use them.</span></summary>
    <div class="row" style="margin:10px 0;gap:8px">${chips||`<span class="muted small">Nothing listed. Add the open packs you want to finish this week.</span>`}</div>
    <div class="row" style="gap:6px"><input id="uu-name" list="uu-ings" placeholder="Ingredient, e.g. mozzarella" autocomplete="off" style="flex:1 1 220px"><input id="uu-amt" inputmode="decimal" placeholder="Amount (optional)" style="width:160px" title="Grams, or pieces for things counted in pieces. Fills in 'At home' on the shopping list."><button class="btn" data-act="uuAdd">Add</button></div>
    <datalist id="uu-ings">${ings.map(([,x])=>`<option value="${esc(x.name)}">`).join("")}</datalist></details>`}
function uuAdd(){const i=$("#uu-name"),a=$("#uu-amt");const q=fold(i.value.trim());if(!q)return;const all=Object.entries(ING);
  let hit=all.find(([,x])=>fold(x.name)===q);
  if(!hit){const c=all.filter(([,x])=>fold(x.name).includes(q));if(c.length===1)hit=c[0];else{toast(c.length?`${c.length} ingredients match. Pick one from the list.`:"No ingredient by that name in your library.");return}}
  const amt=czNum(a.value)||0;USEUP=[...USEUP.filter(u=>u.id!==hit[0]),{id:hit[0],...(amt>0?{amt}:{})}];savePlan();render();toast(`${hit[1].name} added to Use up`)}
function planView(v){
  if(!Object.keys(MEALS).length){v.innerHTML=`<div class="empty">No meals yet. Add recipes on the <button class="linkbtn" data-tabgo="recipes">Recipes</button> tab (Import box), then come back to plan your week.</div>`;return}
  v.innerHTML=`${useupHTML()}<div class="actions" style="margin-top:0"><button class="btn primary" data-act="randAll">Suggest my week</button><button class="btn" data-act="rand:block1">Re-suggest Block 1</button><button class="btn" data-act="rand:block2">Re-suggest Block 2</button><button class="btn" data-act="reset">Reset planner</button></div>
  <div class="panel" style="margin-bottom:16px"><div class="row" style="gap:16px">
    <span class="row"><b class="small">Ground beef this week</b><span class="filters" style="margin:0"><button data-mince="8020" aria-pressed="${minceMode()==="8020"}">80/20</button><button data-mince="lean" aria-pressed="${minceMode()==="lean"}">Lean (5 %)</button></span></span>
    <span class="row"><b class="small">Chicken</b><span class="filters" style="margin:0"><button data-fresh="0" aria-pressed="${!FRESH}">Freezer packs</button><button data-fresh="1" aria-pressed="${FRESH}">Buying fresh</button></span></span></div></div>
  <div class="grid2">${BLOCKS.map(([b,name,days])=>`<section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>${name}</h2><span class="tape">${days}</span></div>
  ${SLOTS.map(([s,label,cat])=>{const sel=PLAN[b][s];const m=PM(sel.meal);
    return`<div class="slot"><label for="${b}-${s}">${label}</label><select id="${b}-${s}" data-b="${b}" data-s="${s}"><option value="">Choose…</option>${mealsFor(cat).map(([id,mm])=>`<option value="${esc(id)}" ${id===sel.meal?"selected":""}>${esc(mm.name)}${isFresh(mm)?" · fresh chicken":""}${CARRY_SLOTS.includes(s)&&isFreezerFit(mm)&&slotServ(b+"|"+s)!==PACK_SERV?` · freezer pack makes ${PACK_SERV}`:""}${mealUses(mm,true).length?" · uses leftovers":""}</option>`).join("")}</select>
    <button class="icon" title="${sel.locked?"Unlock to change this slot":`Suggest a different ${label.toLowerCase()}`}" data-rand="${b}|${s}" aria-label="Random ${label}" ${sel.locked?"disabled style=\"opacity:.4;cursor:not-allowed\"":""}>⟳</button>
    <div class="meta"><div class="step"><button data-dec="${b}|${s}" aria-label="Fewer servings">−</button><input id="${b}-${s}-n" type="number" inputmode="numeric" min="1" value="${sel.need??sel.n}" data-n="${b}|${s}" aria-label="${label} portions eaten"><button data-inc="${b}|${s}" aria-label="More servings">+</button></div><span class="muted small" title="Portions eaten in this block. The planner works out how many to cook.">eating</span>
    <button class="btn tiny${sel.locked?" on":""}" data-lock="${b}|${s}" aria-pressed="${!!sel.locked}" title="${sel.locked?"Locked: Suggest leaves this slot alone. Tap to unlock.":"Lock this slot so Suggest leaves it alone"}">${sel.locked?"Locked":"Lock"}</button>
    ${m?`<span class="prep ${m.prep}">${m.prep}</span>${chipFor(m)}${isFresh(m)?`<span class="chip" title="Made with fresh chicken, not a freezer pack">fresh chicken</span>`:""}${mealUses(m).map(id=>`<span class="chip on">uses: ${esc(ING[id]?.name||id)}</span>`).join("")}${portionHTML(b,s,m)}`:""}</div></div>`}).join("")}
  ${totalsHTML(b)}</section>`).join("")}</div>
  <p class="muted small" style="max-width:65ch">Suggest favours meals that use your Use-up items. <b>Eating</b> is how many portions you need in that block; the planner works out how many to cook. A freezer pack always cooks 6, and any spare in Block 1 carries to the same meal in Block 2. Locked slots stay put when you suggest or reset. Totals are per person per day: Annie eats breakfast, lunch and dinner; Kyle eats the same plus both snacks. Green hits the nutritionist's range, amber is within 10%, red is further off.</p>`}

/* ---------- SHOP ---------- */
function shopView(v){const{reg,b2,lidl,kaufland,removed,spices}=shoppingData();const c=CHECKED;
  if(!reg.length&&!b2.length&&!lidl.length&&!kaufland.length&&!removed.length){v.innerHTML=`<div class="empty">Pick meals on the Plan tab and the shopping list fills in here.</div>`;return}
  const r1=(x,i)=>i.unit==="ks"?+x.toFixed(1):Math.round(x);
  const li=x=>{const k=x.key;
    if(ui.editHome===k)return`<li style="flex-wrap:wrap"><span>${esc(x.name)} <span class="muted small">· plan needs ${fmtAmt(x.orig,x.unit)}</span></span><span class="row" style="gap:4px"><button class="btn primary tiny" data-lremove="${k}" title="You have the full amount the plan needs, so it comes off the list">Have all ${fmtAmt(x.orig,x.unit)}</button><label class="muted small" for="le-home">or some:</label><input id="le-home" inputmode="decimal" data-orig="${x.orig}" value="${x.home>0?cz(r1(x.home,x)):""}" placeholder="0" style="width:80px;text-align:right"><span class="muted">${x.unit==="ks"?"ks":"g"}</span>
      <button class="btn tiny" data-lsave="${k}">Save</button>${x.edited?`<button class="btn tiny" data-lrestore="${k}">Restore</button>`:""}<button class="btn tiny" data-lcancel="1">Cancel</button></span></li>`;
    const hc=x.home>0.05?` <span class="chip near" title="The plan needs ${fmtAmt(x.orig,x.unit)}; you have ${fmtAmt(x.home,x.unit)} at home">${fmtAmt(x.home,x.unit)} at home</span>`:"";
    const tips={"kureci-prsa":(()=>{const s=chickenSplit();return[s.fz?`From the freezer: ${fmtAmt(s.fz,"g")}${packNote("kureci-prsa",s.fz)}`:"",s.fr?`buy fresh: ${fmtAmt(s.fr,"g")}`:""].filter(Boolean).join(" · ")})()};
    const tip=tips[x.id];
    const store=isKauflandPick(x.id)||isLidlPick(x.id)?`<button class="btn tiny" data-store="${x.id}|online" title="Buy this online instead">Online</button>`:`<button class="btn tiny" data-store="${x.id}|lidl">Lidl</button><button class="btn tiny" data-store="${x.id}|kaufland">Kaufland</button>`;
    return`<li data-key="${k}" class="${c[k]?"done":""}"><span>${esc(x.name)}${x.b2&&(isLidlPick(x.id)||isKauflandPick(x.id))?` <span class="chip">Block 2, buy fresh</span>`:""}${hc}${tip?`<span class="muted small" style="display:block">${esc(tip)}</span>`:""}</span><span class="amt">${fmtAmt(x.amt,x.unit)}</span><button class="btn tiny" data-ledit="${k}" title="Enter how much you already have at home">At home</button>${store}</li>`};
  v.innerHTML=`<div class="actions"><button class="btn primary" data-act="copyList">Copy list (for Tesco)</button><button class="btn" data-act="copyPlan">Copy plan + list</button><button class="btn" data-act="showList">${ui.list?"Hide text":"Show text"}</button><button class="btn" data-act="clearChecks">Clear ticks</button>${ui.confirmClear?`<span class="confirm">Clear ticks and At home amounts? <button class="btn danger" data-act="clearDecisionsYes">Clear</button><button class="btn" data-act="clearDecisionsNo">Cancel</button></span>`:`<button class="btn" data-act="clearDecisions" title="Ticks and At home amounts. Also happens on its own each Sunday.">Clear list decisions</button>`}</div>
  ${ui.list?`<pre class="out" id="list-out">${esc(listText())}</pre>`:""}
  <p class="muted small" style="margin:-4px 0 14px">Ticks and At home amounts clear on their own when a new week starts on Sunday. Tick marks are shared between you and Annie.</p>
  <div class="grid2"><section class="panel shop"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Main shop</h2><span class="tape">${reg.length} items</span></div><ul>${reg.map(li).join("")}</ul></section>
  <section class="panel shop"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Block 2 bakery</h2><span class="tape">Buy fresh</span></div>${b2.length?`<ul>${b2.map(li).join("")}</ul>`:`<p class="muted">No fresh bakery items in Block 2.</p>`}
  <p class="muted small">Bread and rolls for days 4–6, bought separately so they're fresh. Mark which items count as bakery on the Ingredients tab.</p></section></div>
  ${[["Lidl pick-up",lidl],["Kaufland pick-up",kaufland]].map(([t,a])=>`<section class="panel shop" style="margin-top:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>${t}</h2><span class="tape">${a.length} items</span></div>${a.length?`<ul>${a.map(li).join("")}</ul>`:`<p class="muted" style="margin:0">Nothing marked yet. Press <b>${t.split(" ")[0]}</b> next to an item to pick it up there instead. Your choice is remembered for future plans.</p>`}</section>`).join("")}
  ${removed.length?`<section class="panel shop" style="margin-top:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Have it all at home</h2><span class="tape">Not bought</span></div><ul>${removed.map(x=>`<li><span class="muted">${esc(x.name)}</span><span class="amt muted">${fmtAmt(x.amt,x.unit)}</span>${x.useup?`<span class="muted small">on your Use-up list</span>`:`<button class="btn tiny" data-lrestore="${x.key}">Restore</button>`}</li>`).join("")}</ul></section>`:""}
  ${spices.length?`<details class="panel" style="margin-top:16px;padding:12px"><summary style="cursor:pointer"><b>Spices and herbs this week</b> <span class="muted small">· ${spices.length} from the cupboard, not on the shopping list</span></summary><p class="small" style="margin:8px 0 0;line-height:1.7">${spices.map(x=>`${esc(x.name)} <span style="font-family:var(--mono)">${fmtAmt(x.amt,"g")}</span>`).join(" · ")}</p></details>`:""}
  <p class="muted small">Tap an item to tick it off. Use <b>At home</b> to enter how much of something you already have; the list buys only the rest.</p>`}
async function setStore(id,where){const S={...(SHOPSET||{})};S.lidlPick={...(S.lidlPick||{})};S.kauflandPick={...(S.kauflandPick||{})};
  delete S.lidlPick[id];delete S.kauflandPick[id];if(where==="lidl")S.lidlPick[id]=true;if(where==="kaufland")S.kauflandPick[id]=true;SHOPSET=S;render();await putDoc("settings/shopping",S)}
async function copyText(txt,msg){try{await navigator.clipboard.writeText(txt);toast(msg)}catch(e){ui.list=true;render();toast("Copy was blocked: the text is shown below, select and copy it.")}}

/* ---------- COOK ---------- */
async function cookLinkHTML(){if(!ui.link){try{ui.link=(await (await fetch("/api/cook-link")).json()).path}catch(e){ui.link=""}render();return}}
function cookView(v){
  const modes=[["prep","Prep day"],["day","Each day"],["week","This week's recipes"],["safety","Food safety"]];
  const url=ui.link?location.origin+ui.link:"";
  if(ui.link===null)cookLinkHTML();
  v.innerHTML=`<div class="filters" role="tablist">${modes.map(([k,l])=>`<button data-cookmode="${k}" aria-pressed="${ui.cookMode===k}">${l}</button>`).join("")}</div>
  <details class="panel" style="margin-bottom:16px;padding:12px"><summary style="cursor:pointer"><b>Link for Annie</b> <span class="muted small">· opens this Cook page, no password</span></summary>
    <p class="small" style="margin:8px 0">Anyone with this link can see this week's cooking steps (not your shopping list, recipes library or settings). Send it to Annie once and she can keep it as a bookmark. <b>New link</b> switches the old one off.</p>
    <div class="row"><input id="cook-url" readonly value="${esc(url)}" style="flex:1 1 280px" onfocus="this.select()"><button class="btn primary" data-act="copyLink">Copy link</button><button class="btn danger" data-act="newLink">New link…</button></div></details>
  <div id="cookbody">${ui.cookMode==="prep"?prepHTML():ui.cookMode==="day"?eachDayHTML():ui.cookMode==="week"?weekRecipesHTML():safetyHTML(true)}</div>`}

/* ---------- SETTINGS ---------- */
async function loadBackups(){try{ui.backups=(await (await fetch("/api/backups")).json()).files}catch(e){ui.backups=[]}render()}
function settingsView(v){if(ui.backups===null||ui.backups===undefined){loadBackups();ui.backups=[]}
  const when=f=>{const m=f.match(/mealprep-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(.*)\.json/);return m?`${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} UTC · ${m[7].replace(/-/g," ")}`:f};
  v.innerHTML=`<div class="grid2">
  <section class="panel"><h2>Backup</h2><p class="muted small">The app saves a backup by itself every night and keeps the last 14. You can also keep your own copy.</p>
    <div class="actions" style="margin-top:8px"><a class="btn primary" href="/api/backup" download>Download a backup file</a><button class="btn" data-act="backupNow">Back up now</button></div>
    <h3 style="margin-top:12px">Saved backups on the server</h3>${ui.backups.length?`<ul class="plain">${ui.backups.slice(0,12).map(f=>`<li><span>${esc(when(f))}</span> <button class="btn tiny" data-restore="${esc(f)}">Restore…</button></li>`).join("")}</ul>`:`<p class="muted small">None yet.</p>`}
    <div id="restore-confirm"></div></section>
  <section class="panel"><h2>Bring in your data</h2><p class="muted small">Use this once to move everything over from the old planner, or to restore a downloaded backup. A backup of what's here is taken first.</p>
    <input type="file" id="imp-file" accept=".json,application/json"><div id="imp-msg" class="small" style="margin-top:8px"></div></section>
  <section class="panel"><h2>Password</h2><p class="muted small">Change the password for ${esc(ME&&ME!=="dev"?ME:"your login")}. Your browser will ask you to sign in again.</p>
    ${ui.pw?`<div class="row"><input id="pw1" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" style="flex:1 1 220px"><button class="btn primary" data-act="pwSave">Save</button><button class="btn" data-act="pwCancel">Cancel</button></div>`:`<button class="btn" data-act="pwOpen">Change my password</button>`}</section>
  <section class="panel"><h2>About</h2><p class="small">Meal Prep Planner v${esc(APPV)}. Two logins (Kyle and Annie) share one plan. The Cook page can also be opened without a password through the link on the Cook tab.</p></section></div>`;
  const f=$("#imp-file");if(f)f.onchange=()=>importAll(f.files[0])}
async function importAll(file){const msg=$("#imp-msg");if(!file)return;
  try{const j=JSON.parse(await file.text());const n=j.docs&&Object.keys(j.docs).length;if(!n)throw new Error("This doesn't look like a Meal Prep export.");
    const meals=Object.keys(j.docs).filter(p=>p.startsWith("meals/")).length;
    msg.innerHTML=`<div class="confirm"><span>${n} items found (${meals} meals${j.docs["lib/ingredients"]?`, ${Object.keys(j.docs["lib/ingredients"].items||{}).length} ingredients`:""}). Add them to what's here, or replace everything?</span><button class="btn primary" id="imp-merge">Add to what's here</button><button class="btn danger" id="imp-repl">Replace everything</button></div>`;
    const run=async mode=>{msg.textContent="Importing…";const r=await fetch("/api/import",{method:"POST",headers:jhead,body:JSON.stringify({docs:j.docs,mode})});const o=await r.json();
      if(!r.ok){msg.innerHTML=`<span class="err">${esc(o.error||"Import failed")}</span>`;return}msg.innerHTML=`<span class="ok">Imported ${o.imported} items.</span>`;await reloadAll();ui.backups=null;toast("Imported")};
    $("#imp-merge").onclick=()=>run("merge");$("#imp-repl").onclick=()=>run("replace")}
  catch(e){msg.innerHTML=`<span class="err">${esc(e.message||e)}</span>`}}

/* ---------- events ---------- */
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.target.id==="uu-name"||e.target.id==="uu-amt")){e.preventDefault();uuAdd()}});
document.addEventListener("change",e=>{const t=e.target;
  if(t.id==="has-thermo"){SAFETY={...(SAFETY||{}),thermometer:t.checked};render();putDoc("settings/safety",SAFETY);return}
  if(t.dataset.b&&t.dataset.s){const sl=PLAN[t.dataset.b][t.dataset.s];sl.meal=t.value;sl.fresh=false;reconcile();sl.fresh=!!(t.value&&FRESH&&CARRY_SLOTS.includes(t.dataset.s)&&isFreezerFit(MEALS[t.value])&&slotServ(t.dataset.b+"|"+t.dataset.s)!==PACK_SERV);savePlan();render();return}
  if(t.dataset.n){const[b,s]=t.dataset.n.split("|");PLAN[b][s].need=Math.max(1,parseInt(t.value)||1);savePlan();t.blur();render();return}
  libChange(t)});
document.addEventListener("click",e=>{const t=e.target.closest("button,[data-open],li[data-key]");if(!t)return;const d=t.dataset;
  if(d.tabgo)return go(d.tabgo);
  if(d.act==="reload"){reloadAll();return}
  if(d.lock){const[b,s]=d.lock.split("|");PLAN[b][s].locked=!PLAN[b][s].locked;savePlan();render();toast(PLAN[b][s].locked?"Locked: Suggest will leave this slot alone":"Unlocked")}
  else if(d.rand){const[b,s]=d.rand.split("|");if(PLAN[b][s].locked)return;const cat=SLOTS.find(x=>x[0]===s)[2];assignMeal(b,s,randomPick(cat,[PLAN[b][s].meal],d.rand,FRESH&&(cat==="lunch"||cat==="dinner")&&!planFresh(d.rand)));savePlan();render()}
  else if(d.slotfresh){const[b,s,on]=d.slotfresh.split("|");PLAN[b][s].fresh=on==="1";savePlan();render()}
  else if(d.nocarry){const[s,on]=d.nocarry.split("|");PLAN.block2[s].noCarry=on==="1";savePlan();render()}
  else if(d.uudel){USEUP=USEUP.filter(u=>u.id!==d.uudel);savePlan();render()}
  else if(d.act==="uuAdd")uuAdd();
  else if(d.inc||d.dec){const[b,s]=(d.inc||d.dec).split("|");PLAN[b][s].need=Math.max(1,needOf(PLAN[b][s])+(d.inc?1:-1));savePlan();render()}
  else if(d.act==="randAll"){randBlocks(["block1","block2"]);savePlan();render();toast("Suggested your week")}
  else if(d.act?.startsWith("rand:")){randBlocks([d.act.slice(5)]);savePlan();render()}
  else if(d.act==="reset"){const keep=PLAN;PLAN=emptyPlan();for(const[b] of BLOCKS)for(const[s] of SLOTS)if(keep[b][s].locked)PLAN[b][s]={...keep[b][s]};EDITS={};CHECKED={};SWAPS={};DISMISSED={};MINCE="8020";FRESH=false;savePlan();render()}
  else if(d.mince){MINCE=d.mince;savePlan();render();toast(MINCE==="lean"?"Lean (5 %) ground beef this week":"80/20 ground beef: the recipes say when to drain it")}
  else if(d.fresh!==undefined){FRESH=d.fresh==="1";savePlan();render();toast(FRESH?"Buying fresh chicken: Suggest will include a fresh-chicken recipe":"Chicken from the freezer")}
  else if(d.ledit){ui.editHome=d.ledit;render();const i=$("#le-home");if(i){i.focus();i.select()}}
  else if(d.lsave){const i=$("#le-home");const val=czNum(i.value)||0;if(val<0){toast("Enter how much you have at home, or 0.");return}if(val===0)delete EDITS[d.lsave];else EDITS[d.lsave]={home:val};ui.editHome=null;savePlan();render()}
  else if(d.lremove){EDITS[d.lremove]={removed:true};ui.editHome=null;savePlan();render();toast("Off the list. It's under “Have it all at home” if you need it back.")}
  else if(d.lrestore){delete EDITS[d.lrestore];ui.editHome=null;savePlan();render()}
  else if(d.lcancel){ui.editHome=null;render()}
  else if(d.store){const[id,w]=d.store.split("|");setStore(id,w)}
  else if(d.act==="copyList")copyText(listText(),"List copied: paste it into the chat with Claude");
  else if(d.act==="copyPlan")copyText(planText()+"\n\n"+listText(),"Plan and list copied");
  else if(d.act==="showList"){ui.list=!ui.list;render()}
  else if(d.act==="clearChecks"){CHECKED={};savePlan();render()}
  else if(d.act==="clearDecisions"){ui.confirmClear=true;render()}
  else if(d.act==="clearDecisionsNo"){ui.confirmClear=false;render()}
  else if(d.act==="clearDecisionsYes"){ui.confirmClear=false;EDITS={};CHECKED={};savePlan();render();toast("List decisions cleared")}
  else if(d.cookmode){ui.cookMode=d.cookmode;render()}
  else if(d.act==="copyLink"){copyText(location.origin+ui.link,"Link copied")}
  else if(d.act==="newLink"){if(!confirm("Switch off the old link and make a new one? Annie will need the new link."))return;fetch("/api/cook-link/new",{method:"POST"}).then(r=>r.json()).then(j=>{ui.link=j.path;render();toast("New link made")})}
  else if(d.act==="backupNow"){fetch("/api/backup-now",{method:"POST"}).then(()=>{ui.backups=null;render();toast("Backup saved on the server")})}
  else if(d.restore){$("#restore-confirm").innerHTML=`<div class="confirm" style="margin-top:8px"><span>Replace everything with this backup? (A backup of the current data is saved first.)</span><button class="btn danger" data-restoreyes="${esc(d.restore)}">Restore</button></div>`}
  else if(d.restoreyes){fetch("/api/restore/"+d.restoreyes,{method:"POST"}).then(async r=>{if(!r.ok){toast("Restore failed");return}ui.backups=null;await reloadAll();toast("Restored")})}
  else if(d.act==="pwOpen"){ui.pw=true;render()}
  else if(d.act==="pwCancel"){ui.pw=false;render()}
  else if(d.act==="pwSave"){const pw=$("#pw1").value;fetch("/api/password",{method:"POST",headers:jhead,body:JSON.stringify({password:pw})}).then(async r=>{const j=await r.json();if(!r.ok){toast(j.error||"Couldn't change the password");return}ui.pw=false;render();toast("Password changed. Sign in again when asked.")})}
  else if(d.key){const k=d.key;CHECKED={...CHECKED};if(CHECKED[k])delete CHECKED[k];else CHECKED[k]=true;t.classList.toggle("done",!!CHECKED[k]);savePlan()}
  else libClick(t,d)});

window.addEventListener("beforeunload",e=>{if(dirty()){e.preventDefault();e.returnValue=""}});
(async()=>{renderTabs();try{await reloadAll()}catch(e){$("#status").textContent="Couldn't load your data. Check your connection and reload."}})();
