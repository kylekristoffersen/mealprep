/* Meal Prep Planner: the main app (Plan, Shop, Cook, Settings, storage). Library screens are in library.js. */
"use strict";
const $=s=>document.querySelector(s);
const TABS=[["deals","Deals"],["plan","Plan"],["prices","Prices"],["shop","Shop"],["cook","Cook"],["recipes","Recipes"],["ingredients","Ingredients"],["targets","Targets"],["settings","Settings"]];
let DOCS={}, tab=(location.hash||"").slice(1).split("&")[0], ME="", APPV="";
const TESCO_IN=new URLSearchParams((location.hash||"").slice(1)).get("tesco");if(TESCO_IN)history.replaceState(null,"",location.pathname+"#prices");
if(!TABS.some(t=>t[0]===tab))tab="plan";
const ui={cookMode:"prep",confirmClear:false,editHome:null,list:false,cat:"all",q:"",open:null,edit:null,servings:6,estOnly:false,mui:null,imp:null,backups:null,link:null,pw:false,deal:null,dealMore:{}};

function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2600)}
const jhead={"Content-Type":"application/json"};
/* a session that ran out (or was signed out elsewhere) sends you to the sign-in page instead of showing errors */
const _fetch=window.fetch.bind(window);
window.fetch=async(...a)=>{const r=await _fetch(...a);if(r.status===401){location.href="/login"}return r};

/* ---------- storage: every save carries the version it started from; a stale save is refused, not overwritten ---------- */
let conflict=false, pending=0;
function showBanner(html){$("#banner").innerHTML=html?`<div class="banner" role="alert">${html}</div>`:""}
function setConflict(info){conflict=true;const when=info?.at?new Date(info.at).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"";
  const by=info?.by?(info.by===ME?"another device or tab signed in as "+info.by:info.by.startsWith("update:")?"a server data update":info.by):"";
  showBanner(`<span><b>Someone else saved a change</b>${by?` (${esc(by)}${when?", "+when:""})`:""} that clashes with yours, so your last change wasn't saved.</span><button class="btn primary" data-act="reload">Reload the latest</button>`)}
/* Plan and deals: when someone else saved in between, merge instead of refusing. Only the parts changed here are written over theirs;
   their other changes are kept. Anything else (recipes, settings) still shows the banner. */
const clone=o=>o===undefined?undefined:JSON.parse(JSON.stringify(o));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const isObj=o=>o&&typeof o==="object"&&!Array.isArray(o);
function merge3(base,mine,theirs){if(same(mine,base))return clone(theirs);if(same(theirs,base)||same(theirs,mine))return clone(mine);
  if(isObj(mine)&&isObj(theirs)){const out={};for(const k of new Set([...Object.keys(mine),...Object.keys(theirs)])){const v=merge3(isObj(base)?base[k]:undefined,mine[k],theirs[k]);if(v!==undefined)out[k]=v}return out}
  return clone(mine)}
const MERGEABLE=new Set(["state/plan","state/deals"]);
async function putDoc(path,data){
  if(conflict)return false;pending++;
  try{const send=async(d,v)=>fetch("/api/doc/"+path,{method:"PUT",headers:jhead,body:JSON.stringify({data:d,version:v})});
    let r=await send(data,DOCS[path]?DOCS[path].version:0);
    if(r.status===409){const j=await fetchAll();const theirs=j.docs[path];
      if(!MERGEABLE.has(path)||!theirs){setConflict(theirs);return false}
      const merged=merge3(DOCS[path]?.data,clone(data),theirs.data);r=await send(merged,theirs.version);
      if(r.status===409){setConflict(theirs);return false}if(!r.ok)throw new Error("HTTP "+r.status);
      const k=await r.json();DOCS=j.docs;DOCS[path]={...theirs,data:merged,version:k.version};
      const typing=document.activeElement&&/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      loadDocs(DOCS);if(!typing)render();toast("Merged with a change saved on another device");return true}
    if(!r.ok)throw new Error("HTTP "+r.status);
    const j=await r.json();DOCS[path]={...(DOCS[path]||{}),data:clone(data),version:j.version};return true}
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
let dealsTimer=null, dealsWriting=false, dealsPending=false;
function saveDeals(){clearTimeout(dealsTimer);dealsTimer=setTimeout(flushDeals,500)}
async function flushDeals(){dealsTimer=null;if(dealsWriting){dealsPending=true;return}dealsWriting=true;
  const ok=await putDoc("state/deals",{deals:DEALS,pick:DEALPICK});dealsWriting=false;if(ok&&dealsPending){dealsPending=false;flushDeals()}}
const dirty=()=>planTimer!==null||planWriting||dealsTimer!==null||dealsWriting||pending>0;
/* A week runs from its prep day to day 6. Once day 6 has passed, the next week starts by itself on the next Sunday or Monday;
   "Plan next week" on the Plan tab starts it early (e.g. planning on Sunday after a Monday-prep week). */
function startWeek(prep){PREP=prep;LISTWEEK=cycleKey();SWAPS={};DISMISSED={};EDITS={};CHECKED={};
  for(const[b] of BLOCKS)for(const[s] of SLOTS){PLAN[b][s].eat=defaultEat(s);PLAN[b][s].extra=0}savePlan()}
function maybeNewWeek(){if(!DOCS["state/plan"])return;
  if(!PREP){PREP=prepDay();LISTWEEK=cycleKey();savePlan();return}
  if(todayISO()>lastDay()){startWeek(defaultPrep());setTimeout(()=>toast(`New week, prep day ${fmtDate(PREP)}: ticks, At home amounts and who's eating were reset.`),800)}}

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
function render(){reconcile();renderTabs();document.body.dataset.tab=tab;const v=$("#view");
  if(tab==="deals")dealsView(v);else if(tab==="plan")planView(v);else if(tab==="shop")shopView(v);else if(tab==="prices")pricesView(v);else if(tab==="cook")cookView(v);
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
let UU_UNDO=[]; // session-only snapshots of USEUP, newest last
function uuSnap(){UU_UNDO.push(JSON.parse(JSON.stringify(USEUP)));if(UU_UNDO.length>20)UU_UNDO.shift()}
function uuUndo(){if(!UU_UNDO.length)return;USEUP=UU_UNDO.pop();savePlan();render();toast("Undone")}
function useupHTML(){const ings=Object.entries(ING).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
  const chips=USEUP.filter(u=>ING[u.id]).map(u=>{const st=uuStatus(u);const x=ING[u.id];
    const s=st.done?`✓ all used · in ${st.names.join(", ")}`:st.names.length?`${u.amt>0?`${fmtAmt(st.t,x.unit)} of ${fmtAmt(u.amt,x.unit)} · `:""}in ${st.names.join(", ")}`:"not in the plan yet";
    return`<div class="uu-card ${st.names.length?"on":"near"}" data-uuedit="${esc(u.id)}" title="${esc(`${x.name}: ${s}`)} · Tap to edit the amount"><div class="uu-text"><div class="uu-name">${esc(x.name)}${u.amt>0?` · ${fmtAmt(u.amt,x.unit)}`:""}</div><div class="uu-status">${esc(s)}</div></div><button class="icon" data-uudel="${esc(u.id)}" title="Remove from Use up" aria-label="Remove ${esc(x.name)}" style="width:26px;height:26px;flex-shrink:0">×</button></div>`}).join("");
  return`<details class="panel" style="margin-bottom:12px" ${USEUP.length||UU_UNDO.length?"open":""}><summary style="cursor:pointer"><b>Use up</b> <span class="muted small">Open packs and leftovers. Suggest favours meals that use them. Tap an item to edit its amount.</span></summary>
    <div class="${chips?"uu-grid":"row"}" style="margin:10px 0">${chips||`<span class="muted small">Nothing listed. Add the open packs you want to finish this week.</span>`}</div>
    <div class="row" style="gap:6px"><input id="uu-name" data-ingpick placeholder="Ingredient, e.g. mozzarella" autocomplete="off" style="flex:1 1 220px"><input id="uu-amt" inputmode="decimal" placeholder="Amount (optional)" style="width:160px" title="Grams, or pieces for things counted in pieces. Fills in 'At home' on the shopping list."><button class="btn" data-act="uuAdd">Add</button>${UU_UNDO.length?`<button class="btn" data-act="uuUndo">↶ Undo</button>`:""}</div></details>`}
function uuAdd(){const i=$("#uu-name"),a=$("#uu-amt");if(!i.value.trim())return;const{hit,count}=resolveIng(i.value);
  if(!hit){toast(count?`${count} ingredients match. Pick one from the list.`:"No ingredient by that name in your library.");return}
  const amt=czNum(a.value)||0;uuSnap();const row={id:hit[0],...(amt>0?{amt}:{})};const ix=USEUP.findIndex(u=>u.id===hit[0]);if(ix>=0)USEUP[ix]=row;else USEUP.push(row);savePlan();render();toast(ix>=0?`${hit[1].name} updated`:`${hit[1].name} added to Use up`)}
function prepPickHTML(){const p=prepDay(),opts=[cycleKey(),addDays(cycleKey(),1)];
  const near=todayISO()>=dayDate(4);
  return`<span class="row"><b class="small">Prep day</b><span class="filters" style="margin:0">${opts.map(x=>`<button data-prep="${x}" aria-pressed="${x===p}">${esc(fmtDate(x))}</button>`).join("")}</span><span class="muted small">eating ${esc(fmtDate(dayDate(0)))} – ${esc(fmtDate(lastDay()))}</span>${near?`<button class="btn tiny" data-act="nextWeek" title="Start the next week now: clears ticks, At home amounts and who's eating">Plan next week</button>`:""}</span>`}
function eatGridHTML(b){const st=blockStart(b);
  const pill=(on,attr,lbl,p)=>`<button class="eatpill ${p}${on?" on":""}" ${attr} aria-pressed="${on}" aria-label="${esc(lbl)}">${p.toUpperCase()}</button>`;
  const dayOn=(d,p)=>SLOTS.some(([s])=>eaters(s).includes(p)&&PLAN[b][s].eat[d][PIDX[p]]);
  return`<table class="eatgrid"><caption class="sr">Who's eating each meal</caption><thead><tr><th></th>${[0,1,2].map(d=>{const dt=fmtDate(dayDate(st+d)).split(" ");
    return`<th scope="col"><span class="dname">${esc(dt[0])} <span class="muted">${esc(dt[1])}</span></span><span class="pp">${PEOPLE.map(([p,n])=>pill(dayOn(d,p),`data-eatday="${b}|${d}|${p}"`,`${n}, all of ${dt.join(" ")}`,p)).join("")}</span></th>`}).join("")}</tr></thead>
  <tbody>${SLOTS.map(([s,label,cat])=>`<tr data-cat="${cat}"><th scope="row">${esc(label)}</th>${[0,1,2].map(d=>`<td>${eaters(s).map(p=>pill(!!PLAN[b][s].eat[d][PIDX[p]],`data-eat="${b}|${s}|${d}|${p}"`,`${PEOPLE[PIDX[p]][1]}, ${label}, ${fmtDate(dayDate(st+d))}`,p)).join("")}</td>`).join("")}</tr>`).join("")}</tbody></table>`}
function planView(v){
  if(!Object.keys(MEALS).length){v.innerHTML=`<div class="empty">No meals yet. Add recipes on the <button class="linkbtn" data-tabgo="recipes">Recipes</button> tab (Import box), then come back to plan your week.</div>`;return}
  v.innerHTML=`${useupHTML()}${dealsStripHTML()}<div class="actions" style="margin-top:0"><button class="btn primary" data-act="randAll">Suggest my week</button><button class="btn" data-act="rand:block1">Re-suggest Block 1</button><button class="btn" data-act="rand:block2">Re-suggest Block 2</button><button class="btn" data-act="reset">Reset planner</button></div>
  <div class="panel" style="margin-bottom:16px"><div class="row" style="gap:16px">
    ${prepPickHTML()}
    <span class="row"><b class="small">Ground beef this week</b><span class="filters" style="margin:0"><button data-mince="8020" aria-pressed="${minceMode()==="8020"}">80/20</button><button data-mince="lean" aria-pressed="${minceMode()==="lean"}">Lean (5 %)</button></span></span>
    <span class="row"><b class="small">Chicken</b><span class="filters" style="margin:0"><button data-fresh="0" aria-pressed="${!FRESH}">Freezer packs</button><button data-fresh="1" aria-pressed="${FRESH}">Buying fresh</button></span></span></div></div>
  <div class="grid2">${BLOCKS.map(([b,name])=>`<section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:6px"><h2>${name}</h2><span class="tape">${blockDays(b)}</span></div>
  ${eatGridHTML(b)}
  ${SLOTS.map(([s,label,cat])=>{const sel=PLAN[b][s];const m=PM(sel.meal);
    return`<div class="slot"><label for="${b}-${s}">${label}</label><select id="${b}-${s}" data-b="${b}" data-s="${s}"><option value="">Choose…</option>${mealsFor(cat).map(([id,mm])=>`<option value="${esc(id)}" ${id===sel.meal?"selected":""}>${esc(mm.name)}${isFresh(mm)?" · fresh chicken":""}${CARRY_SLOTS.includes(s)&&isFreezerFit(mm)&&slotServ(b+"|"+s)!==PACK_SERV?` · freezer pack makes ${PACK_SERV}`:""}${mealUses(mm,true).length?" · uses leftovers":""}${mealDeals(PM(id)).length?" · on deal":""}</option>`).join("")}</select>
    <button class="icon" title="${sel.locked?"Unlock to change this slot":`Suggest a different ${label.toLowerCase()}`}" data-rand="${b}|${s}" aria-label="Random ${label}" ${sel.locked?"disabled style=\"opacity:.4;cursor:not-allowed\"":""}>⟳</button>
    <div class="meta"><div class="step"><button data-dec="${b}|${s}" aria-label="Fewer servings">−</button><input id="${b}-${s}-n" type="number" inputmode="numeric" min="1" value="${sel.need??sel.n}" min="0" data-n="${b}|${s}" aria-label="${label} portions eaten"><button data-inc="${b}|${s}" aria-label="More servings">+</button></div><span class="muted small" title="Portions eaten in this block: the ticks above, plus any extra. The planner works out how many to cook.">eating${sel.extra?` (${sel.extra} extra)`:""}</span>${!sel.need?`<span class="chip off" title="Nobody is ticked for this meal in this block, so it isn't cooked or bought">skipped</span>`:""}
    <button class="btn tiny${sel.locked?" on":""}" data-lock="${b}|${s}" aria-pressed="${!!sel.locked}" title="${sel.locked?"Locked: Suggest leaves this slot alone. Tap to unlock.":"Lock this slot so Suggest leaves it alone"}">${sel.locked?"Locked":"Lock"}</button>
    ${m?`<span class="prep ${m.prep}">${m.prep}</span>${chipFor(m)}${isFresh(m)?`<span class="chip" title="Made with fresh chicken, not a freezer pack">fresh chicken</span>`:""}${mealUses(m).map(id=>`<span class="chip on">uses: ${esc(ING[id]?.name||id)}</span>`).join("")}${mealDeals(m).map(id=>`<span class="chip on wrap" title="Deal from the leták">deal: ${esc(ING[id]?.name||id)} · ${esc(dealLabel(dealsFor(id)[0]))}</span>`).join("")}${portionHTML(b,s,m)}`:""}</div></div>`}).join("")}
  ${totalsHTML(b)}</section>`).join("")}</div>
  <p class="muted small" style="max-width:65ch">Suggest favours meals that use your Use-up items. Tap <b>K</b> (Kyle) or <b>A</b> (Annie) in a block's week grid to mark a meal you won't be eating; a day's header switches that person off for the whole day. <b>Eating</b> counts the ticks, and + adds extra portions (guests, a spare). The planner works out how many to cook, and a meal nobody eats is skipped. A freezer pack always cooks 6, and any spare in Block 1 carries to the same meal in Block 2. Locked slots stay put when you suggest or reset. Totals are per person per day: Annie eats breakfast, lunch and dinner; Kyle eats the same plus both snacks. Green hits the nutritionist's range, amber is within 10%, red is further off.</p>`}

/* ---------- DEALS: what the letáky have this week, and how it feeds the plan ---------- */
const newDeal=()=>({name:"",store:"Albert",price:"",amt:"1",u:"kg",was:"",until:addDays(weekKey(),7),note:"",edit:null});
let DEAL_UNDO=[]; // session-only snapshots, newest last
function dealSnap(){DEAL_UNDO.push(JSON.parse(JSON.stringify({deals:DEALS,pick:DEALPICK})));if(DEAL_UNDO.length>20)DEAL_UNDO.shift()}
function dealUndo(){if(!DEAL_UNDO.length)return;const x=DEAL_UNDO.pop();DEALS=x.deals;DEALPICK=x.pick;ui.deal&&(ui.deal.edit=null);saveDeals();render();toast("Undone")}
function dealsStripHTML(){const act=activeDeals();
  if(!act.length)return`<div class="panel" style="margin-bottom:12px"><span class="small"><b>Deals</b> <span class="muted">None added for this week.</span> <button class="linkbtn" data-tabgo="deals">Add this week's finds</button> <span class="muted">and Suggest will favour meals that use them.</span></span></div>`;
  const ids=[...new Set(act.map(d=>d.id))].sort((a,b)=>ING[a].name.localeCompare(ING[b].name,"cs"));
  const chips=ids.map(id=>{const names=[...new Set(dealPlanMeals(id).map(x=>x.name))];
    return`<span class="chip ${names.length?"on":"near"}" style="white-space:normal">${esc(ING[id].name)} · ${esc(dealLabel(dealsFor(id)[0]))}: ${names.length?esc(names.join(", ")):"not in the plan yet"}</span>`}).join("");
  return`<details class="panel" style="margin-bottom:12px" open><summary style="cursor:pointer"><b>Deals this week</b> <span class="muted small">${ids.filter(id=>dealPlanMeals(id).length).length} of ${ids.length} are in the plan</span></summary>
    <div class="row" style="margin:10px 0 6px;gap:8px">${chips}</div><p class="muted small" style="margin:0">Suggest favours meals that use these. <button class="linkbtn" data-tabgo="deals">Manage deals and add meals that use them</button></p></details>`}
function dealRow(d,i){const x=ING[d.id],name=x?x.name:d.id,p=dealPct(d);
  const inPlan=dealPlanMeals(d.id),planned=new Set(inPlan.map(y=>y.meal));
  const ms=dealMeals(d.id).sort((a,b)=>(planned.has(b)?1:0)-(planned.has(a)?1:0));const more=ui.dealMore[d.id],shown=more?ms:ms.slice(0,6);
  const chip=mid=>planned.has(mid)?`<button class="chipbtn on" data-dealrm="${esc(mid)}" title="In the plan. Tap to take it out again">✓ ${esc(MEALS[mid].name)} · ${esc(inPlan.find(y=>y.meal===mid).where)}</button>`:`<button class="chipbtn" data-dealadd="${esc(mid)}" title="Put this meal in the plan">+ ${esc(MEALS[mid].name)}</button>`;
  const hint=d.id===LEAN_MINCE&&MINCE!=="lean"?`Ground beef is set to 80/20 this week, so recipes don't use this one. <button class="btn tiny" data-mince="lean">Switch to Lean (5 %)</button>`
    :d.id===FAT_MINCE&&MINCE==="lean"?`Ground beef is set to Lean (5 %) this week, so recipes don't use this one. <button class="btn tiny" data-mince="8020">Switch to 80/20</button>`:"";
  return`<li class="deal"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:8px"><div class="row" style="gap:6px 8px"><b>${esc(name)}</b><span class="chip">${esc(d.store)}</span><b class="mono">${esc(dealPriceText(d))}</b>${p?`<span class="chip on" title="Normal price ${esc(kc(d.was))} Kč">−${p} %</span>`:""}<span class="muted small">to ${esc(fmtDate(d.until))}${d.note?" · "+esc(d.note):""}${ONLINE_STORES.includes(d.store)?" · ordered online":""}</span></div>
    <span class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn tiny" data-dealedit="${i}">Edit</button><button class="btn tiny" data-dealdel="${i}" aria-label="Remove ${esc(name)} deal">Remove</button></span></div>
    ${hint?`<p class="small" style="margin:6px 0 0">${hint}</p>`:""}
    <div class="row" style="gap:6px;margin-top:8px"><span class="muted small">Meals:</span>${ms.length?shown.map(chip).join(""):`<span class="muted small">No meal in your library uses this yet.</span>`}${ms.length>6?`<button class="linkbtn" data-dealmore="${esc(d.id)}">${more?"Show fewer":"+"+(ms.length-6)+" more"}</button>`:""}</div></li>`}
function dealsView(v){const f=ui.deal||(ui.deal=newDeal());const ed=f.edit!=null;
  const rows=DEALS.map((d,i)=>({d,i}));
  const act=rows.filter(r=>dealActive(r.d)).sort((a,b)=>ING[a.d.id].name.localeCompare(ING[b.d.id].name,"cs")||(dealUnit(a.d)?.price??0)-(dealUnit(b.d)?.price??0));
  const old=rows.filter(r=>!dealActive(r.d));
  v.innerHTML=`${letakyHTML()}<section class="panel" id="dealform" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${ed?"Edit deal":"Add a deal"}</h2></div>
    <p class="muted small" style="margin:4px 0 12px;max-width:65ch">Read the letáky, then add what's worth planning around. Each deal shows which of your meals use it, and Suggest favours those meals.</p>
    <div class="form-grid"><label>Ingredient<input data-df="name" data-ingpick value="${esc(f.name)}" autocomplete="off" placeholder="e.g. Kuřecí prsa"></label>
    <label>Store<select data-df="store">${STORES.map(s=>`<option ${s===f.store?"selected":""}>${s}</option>`).join("")}</select></label>
    <label>Price (Kč)<input data-df="price" inputmode="decimal" value="${esc(f.price)}" placeholder="89,90"></label>
    <label>…for<span class="row" style="flex-wrap:nowrap;gap:6px"><input data-df="amt" inputmode="decimal" value="${esc(f.amt)}" style="width:72px"><select data-df="u">${["kg","g","ks"].map(u=>`<option ${u===f.u?"selected":""}>${u}</option>`).join("")}</select></span></label>
    <label>Valid until<input type="date" data-df="until" value="${esc(f.until)}"></label></div>
    <details style="margin-top:10px" ${f.was||f.note?"open":""}><summary class="small" style="cursor:pointer">Optional: normal price and note</summary><div class="form-grid" style="margin-top:8px"><label>Normal price (Kč, for the same amount)<input data-df="was" inputmode="decimal" value="${esc(f.was)}" placeholder="119,90"></label><label>Note<input data-df="note" value="${esc(f.note)}" placeholder="e.g. with Clubcard, max 3 pcs"></label></div></details>
    <div class="actions" style="margin-bottom:0"><button class="btn primary" data-act="dealAdd">${ed?"Save changes":"Add deal"}</button>${ed?`<button class="btn" data-act="dealCancel">Cancel</button>`:""}${DEAL_UNDO.length?`<button class="btn" data-act="dealUndo">↶ Undo</button>`:""}</div></section>
  ${act.length?`<section class="panel"><div class="row" style="justify-content:space-between;margin-bottom:4px"><h2>This week's deals</h2><span class="tape">${act.length} deals</span></div><ul class="dealist">${act.map(r=>dealRow(r.d,r.i)).join("")}</ul>
    <p class="muted small" style="margin:12px 0 0;max-width:65ch">Tap <b>+ meal</b> to put it in the plan (it takes an empty slot, or one that has no deal or leftover use). Prices appear on the Plan and Shop tabs; on Shop you can send an item to the store that has it on offer.</p></section>`
    :`<div class="empty">No deals for this week yet. Open the letáky, then add what you find above.</div>`}
  ${old.length?`<details class="panel" style="margin-top:16px"><summary style="cursor:pointer"><b>Expired</b> <span class="muted small">${old.length} past deal${old.length===1?"":"s"}</span></summary><ul class="plain">${old.map(r=>`<li>${esc(ING[r.d.id]?.name||r.d.id)} · ${esc(r.d.store)} · ${ING[r.d.id]?esc(dealPriceText(r.d)):kc(r.d.price)+" Kč"} <span class="muted">(ended ${esc(fmtDate(r.d.until))})</span></li>`).join("")}</ul><button class="btn" data-act="dealClearOld">Clear expired</button></details>`:""}`}
function dealAdd(){const f=ui.deal;if(!f)return;
  if(!f.name.trim()){toast("Type the ingredient first.");return}
  const{hit,count}=resolveIng(f.name);
  if(!hit){toast(count?`${count} ingredients match. Pick one from the list.`:"No ingredient by that name in your library. Add it on the Ingredients tab first.");return}
  const price=czNum(f.price),amt=czNum(f.amt)||1,was=czNum(f.was)||0,ks=hit[1].unit==="ks";
  if(!(price>0)){toast("Enter the price in Kč.");return}
  if(ks!==(f.u==="ks")){toast(`${hit[1].name} is counted ${ks?"in pieces (ks)":"by weight: use kg or g"}.`);return}
  if(!/^\d{4}-\d\d-\d\d$/.test(f.until||"")){toast("Enter the date the deal ends. It's on the leták.");return}
  if(f.until<todayISO()){toast("That end date has already passed.");return}
  if(was&&was<=price){toast("The normal price should be higher than the deal price. Leave it empty if you're not sure.");return}
  const row={id:hit[0],store:f.store,price,amt,u:f.u,until:f.until,...(was?{was}:{}),...(f.note.trim()?{note:f.note.trim()}:{})};
  dealSnap();const edit=f.edit!=null&&DEALS[f.edit];if(edit)DEALS[f.edit]=row;else DEALS.push(row);
  ui.deal={...newDeal(),store:f.store,until:f.until};saveDeals();render();toast(`${hit[1].name}: ${dealLabel(row)} ${edit?"updated":"added"}`);
  const n=document.querySelector('[data-df="name"]');if(n)n.focus()}
function dealPlace(mid){const m=MEALS[mid];if(!m)return;
  const cands=[];for(const[b,bn] of BLOCKS)for(const[s,sn,cat] of SLOTS)if(cat===m.cat&&!PLAN[b][s].locked)cands.push([b,s,bn,sn]);
  if(!cands.length){toast(`Every ${m.cat} slot is locked. Unlock one on the Plan tab.`);return}
  const free=([b,s])=>!PLAN[b][s].meal,plain=([b,s])=>{const x=PM(PLAN[b][s].meal);return!mealDeals(x).length&&!mealUses(x).length};
  const[b,s,bn,sn]=cands.find(free)||cands.find(plain)||cands[cands.length-1];
  const prev=MEALS[PLAN[b][s].meal]?.name;assignMeal(b,s,mid);savePlan();render();toast(`${m.name} is now ${bn} ${sn.toLowerCase()}${prev?` (replaced ${prev})`:""}`)}
function dealUnplace(mid){let n=0,locked=0;for(const[b] of BLOCKS)for(const[s] of SLOTS)if(PLAN[b][s].meal===mid){if(PLAN[b][s].locked)locked++;else{assignMeal(b,s,"");n++}}
  savePlan();render();toast(locked?"That slot is locked. Unlock it on the Plan tab first.":`${MEALS[mid]?.name||"Meal"} taken out of the plan`)}

/* ---------- LETÁKY: links to each shop's leták page, always shown on the Deals tab. Edit the URLs here if a shop moves its page. ---------- */
const LETAKY=[["Kaufland","https://www.kaufland.cz/letak.html"],["Tesco","https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy/tesco-hypermarket-brno-kralovo-pole"],["Albert","https://www.albert.cz/aktualni-letaky"],["Lidl","https://www.lidl.cz/c/akcni-letak/s10008644"],["Billa","https://www.billa.cz/letaky-billa?tab=letaky-billa/velky-letak-nasledujici"]];
function letakyHTML(){return`<div class="panel" style="margin-bottom:12px"><div class="row" style="gap:8px"><b class="small">Letáky</b>${LETAKY.map(([n,u])=>`<a class="btn" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(n)}</a>`).join("")}</div></div>`}

/* ---------- SHOP ---------- */
function shopView(v){const{reg,b2,pickups,dealGroups,removed,spices}=shoppingData();const c=CHECKED;
  if(!reg.length&&!b2.length&&!pickups.some(p=>p.items.length)&&!dealGroups.length&&!removed.length){v.innerHTML=`<div class="empty">Pick meals on the Plan tab and the shopping list fills in here.</div>`;return}
  const r1=(x,i)=>i.unit==="ks"?+x.toFixed(1):Math.round(x);
  const li=x=>{const k=x.key;
    if(ui.editHome===k)return`<li style="flex-wrap:wrap"><span>${esc(x.name)} <span class="muted small">· plan needs ${fmtAmt(x.orig,x.unit)}</span></span><span class="row" style="gap:4px"><button class="btn primary tiny" data-lremove="${k}" title="You have the full amount the plan needs, so it comes off the list">Have all ${fmtAmt(x.orig,x.unit)}</button><label class="muted small" for="le-home">or some:</label><input id="le-home" inputmode="decimal" data-orig="${x.orig}" value="${x.home>0?cz(r1(x.home,x)):""}" placeholder="0" style="width:80px;text-align:right"><span class="muted">${x.unit==="ks"?"ks":"g"}</span>
      <button class="btn tiny" data-lsave="${k}">Save</button>${x.edited?`<button class="btn tiny" data-lrestore="${k}">Restore</button>`:""}<button class="btn tiny" data-lcancel="1">Cancel</button></span></li>`;
    const hc=x.home>0.05?` <span class="chip near" title="The plan needs ${fmtAmt(x.orig,x.unit)}; you have ${fmtAmt(x.home,x.unit)} at home">${fmtAmt(x.home,x.unit)} at home</span>`:"";
    const tips={"kureci-prsa":(()=>{const s=chickenSplit();return[s.fz?`From the freezer: ${fmtAmt(s.fz,"g")}${packNote("kureci-prsa",s.fz)}`:"",s.fr?`buy fresh: ${fmtAmt(s.fr,"g")}`:""].filter(Boolean).join(" · ")})()};
    const tip=tips[x.id];
    const dl=dealsFor(x.id),dp=dealPickStore(x.id);
    const dchips=dl.slice(0,2).map(d=>{const cost=dealCost(d,x.amt),p=dealPct(d);return`<span class="chip on wrap">${esc(dealLabel(d))}${p?` · −${p} %`:""} · to ${esc(fmtDate(d.until))}${cost?` · ≈ ${Math.round(cost)} Kč for ${fmtAmt(x.amt,x.unit)}`:""}${d.note?" · "+esc(d.note):""}</span>`}).join(" ");
    const bd=dl.find(d=>!ONLINE_STORES.includes(d.store));
    const dealBtn=dp?`<button class="btn tiny" data-dealpick="${esc(x.id)}|" title="Put it back on the online list">Back online</button>`
      :bd&&!PICKUPS.some(([k,,st])=>st===bd.store&&pickStore(x.id)===k)?`<button class="btn tiny" data-dealpick="${esc(x.id)}|${esc(bd.store)}" title="Buy this one at ${esc(bd.store)} this week">Buy at ${esc(bd.store)}</button>`:"";
    const store=dp?"":pickStore(x.id)?`<button class="btn tiny" data-store="${x.id}|online" title="Buy this online instead">Online</button>`:`<span class="picks">${PICKUPS.map(([k,label])=>`<button class="btn sq pk-${k}" data-store="${x.id}|${k}" title="Pick up at ${label}" aria-label="Pick up at ${label}">${label[0]}</button>`).join("")}</span>`;
    return`<li data-key="${k}" class="${c[k]?"done":""}"><span>${esc(x.name)}${x.b2&&pickStore(x.id)?` <span class="chip">Block 2, buy fresh</span>`:""}${hc}${tip?`<span class="muted small" style="display:block">${esc(tip)}</span>`:""}${dchips?`<span style="display:block;margin-top:4px">${dchips}</span>`:""}</span><span class="amt">${fmtAmt(x.amt,x.unit)}</span><button class="btn tiny" data-ledit="${k}" title="Enter how much you already have at home">At home</button>${dealBtn}${store}</li>`};
  v.innerHTML=`<div class="actions"><button class="btn primary" data-act="copyList">Copy list (for Tesco)</button><button class="btn" data-act="copyPlan">Copy plan + list</button><button class="btn" data-act="showList">${ui.list?"Hide text":"Show text"}</button><button class="btn" data-act="clearChecks">Clear ticks</button>${ui.confirmClear?`<span class="confirm">Clear ticks and At home amounts? <button class="btn danger" data-act="clearDecisionsYes">Clear</button><button class="btn" data-act="clearDecisionsNo">Cancel</button></span>`:`<button class="btn" data-act="clearDecisions" title="Ticks and At home amounts. Also happens on its own each Sunday.">Clear list decisions</button>`}</div>
  ${ui.list?`<pre class="out" id="list-out">${esc(listText())}</pre>`:""}
  <p class="muted small" style="margin:-4px 0 14px">Ticks and At home amounts clear on their own when the next week starts (after day 6), or when you press <b>Plan next week</b> on the Plan tab. Tick marks are shared between you and Annie.</p>
  <div class="grid2"><section class="panel shop"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Main shop</h2><span class="tape">${reg.length} items</span></div><ul>${reg.map(li).join("")}</ul></section>
  <section class="panel shop"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Block 2 bakery</h2><span class="tape">Buy fresh</span></div>${b2.length?`<ul>${b2.map(li).join("")}</ul>`:`<p class="muted">No fresh bakery items in Block 2.</p>`}
  <p class="muted small">Bread and rolls for days 4–6, bought separately so they're fresh. Mark which items count as bakery on the Ingredients tab.</p></section></div>
  ${pickups.map(({label,items:a})=>[label+" pick-up",a]).map(([t,a])=>`<section class="panel shop" style="margin-top:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>${t}</h2><span class="tape">${a.length} items</span></div>${a.length?`<ul>${a.map(li).join("")}</ul>`:`<p class="muted" style="margin:0">Nothing marked yet. Press <b>${t.split(" ")[0]}</b> next to an item to pick it up there instead. Your choice is remembered for future plans.</p>`}</section>`).join("")}
  ${dealGroups.map(g=>{const tot=g.items.reduce((sum,x)=>{const d=dealsFor(x.id).find(y=>y.store===g.store);return sum+(d?dealCost(d,x.amt):0)},0);return`<section class="panel shop" style="margin-top:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>${esc(g.store)} · this week's deals</h2><span class="tape">${g.items.length} items · ≈ ${Math.round(tot)} Kč</span></div><ul>${g.items.map(li).join("")}</ul></section>`}).join("")}
  ${removed.length?`<section class="panel shop" style="margin-top:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2>Have it all at home</h2><span class="tape">Not bought</span></div><ul>${removed.map(x=>`<li><span class="muted">${esc(x.name)}</span><span class="amt muted">${fmtAmt(x.amt,x.unit)}</span>${x.useup?`<span class="muted small">on your Use-up list</span>`:`<button class="btn tiny" data-lrestore="${x.key}">Restore</button>`}</li>`).join("")}</ul></section>`:""}
  ${spices.length?`<details class="panel" style="margin-top:16px;padding:12px"><summary style="cursor:pointer"><b>Spices and herbs this week</b> <span class="muted small">· ${spices.length} from the cupboard, not on the shopping list</span></summary><p class="small" style="margin:8px 0 0;line-height:1.7">${spices.map(x=>`${esc(x.name)} <span style="font-family:var(--mono)">${fmtAmt(x.amt,"g")}</span>`).join(" · ")}</p></details>`:""}
  <p class="muted small">Tap an item to tick it off. Use <b>At home</b> to enter how much of something you already have; the list buys only the rest.</p>`}
async function setStore(id,where){const S={...(SHOPSET||{})};
  for(const[k] of PICKUPS){const f=k+"Pick";S[f]={...(S[f]||{})};delete S[f][id];if(where===k)S[f][id]=true}SHOPSET=S;render();await putDoc("settings/shopping",S)}
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
  <div id="cookbody">${ui.cookMode==="prep"?prepHTML():ui.cookMode==="day"?eachDayHTML():ui.cookMode==="week"?weekRecipesHTML():safetyHTML(true)}</div>`;applyTicks(v)}

/* ---------- SETTINGS ---------- */
async function loadBackups(){try{ui.backups=(await (await fetch("/api/backups")).json()).files}catch(e){ui.backups=[]}render()}
async function loadStatus(){try{ui.status=await (await fetch("/api/server-status")).json()}catch(e){ui.status={error:String(e)}}render()}
function statusHTML(){const s=ui.status;if(!s)return`<p class="muted small">Checking…</p>`;if(s.error)return`<p class="note">Couldn't read the status: ${esc(s.error)}</p>`;
  const yn=(v,yes,no,unk)=>v==null?`<span class="chip near">${unk}</span>`:v?`<span class="chip off">${yes}</span>`:`<span class="chip on">${no}</span>`;
  const behind=s.diskCommit&&s.runningCommit&&s.diskCommit!==s.runningCommit;
  return`<table><tbody>
  <tr><td>Running version</td><td><b>v${esc(s.version)}</b> <span class="muted small">(${esc(s.runningCommit||"?")}, started ${esc((s.startedAt||"").replace("T"," ").replace("Z"," UTC"))})</span></td></tr>
  <tr><td>Code on the server</td><td>${esc(s.diskCommit||"?")} ${behind?`<span class="chip off">newer code is waiting for a restart</span>`:`<span class="chip on">running</span>`}</td></tr>
  <tr><td>Browser password popup</td><td>${yn(s.nginxPopup,"still on","off (in-page sign-in)","can't read the nginx file")}</td></tr>
  <tr><td>Popup switch</td><td class="small">${s.switchStatus?esc(s.switchStatus):`<span class="muted">No report yet. It appears within a minute of this version going live.</span>`}</td></tr>
  <tr><td>In-page sign-in</td><td>${s.signInOn?`<span class="chip on">on</span>`:`<span class="chip off">off: password file not found</span>`}</td></tr></tbody></table>
  <h3 style="margin-top:12px">Recipe updates from Claude</h3>${(s.dataUpdates||[]).length?`<ul class="plain">${s.dataUpdates.map(u=>`<li><b>${esc(u.note||u.id)}</b> <span class="muted small">${esc((u.at||"").replace("T"," ").replace("Z"," UTC"))} · ${u.applied.length} changed${u.skipped.length?` · <span class="err">${u.skipped.length} skipped</span>`:""} · backup ${esc(u.backup||"")}</span>${u.skipped.length?`<div class="small">${u.skipped.map(x=>`${esc(x.path.replace("meals/",""))}: ${esc(x.why)}`).join("<br>")}</div>`:""}</li>`).join("")}</ul>`:`<p class="muted small">None yet. They arrive through GitHub, with a backup taken first; a meal you've edited since is left alone.</p>`}
  <h3 style="margin-top:12px">Last update messages</h3>${s.updateLog==null?`<p class="muted small">The update log can't be read.</p>`:s.updateLog.length?`<pre class="logbox">${esc(s.updateLog.join("\n"))}</pre>`:`<p class="muted small">Nothing logged yet.</p>`}
  <div class="actions" style="margin-top:8px"><button class="btn" data-act="statusRefresh">Check again</button></div>`}
function settingsView(v){if(ui.backups===null||ui.backups===undefined){loadBackups();ui.backups=[]}if(ui.status===undefined){ui.status=null;loadStatus()}
  const when=f=>{const m=f.match(/mealprep-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(.*)\.json/);return m?`${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} UTC · ${m[7].replace(/-/g," ")}`:f};
  v.innerHTML=`<div class="grid2">
  <section class="panel"><h2>Backup</h2><p class="muted small">The app saves a backup by itself every night and keeps the last 14. You can also keep your own copy.</p>
    <div class="actions" style="margin-top:8px"><a class="btn primary" href="/api/backup" download>Download a backup file</a><button class="btn" data-act="backupNow">Back up now</button></div>
    <h3 style="margin-top:12px">Saved backups on the server</h3>${ui.backups.length?`<ul class="plain">${ui.backups.slice(0,12).map(f=>`<li><span>${esc(when(f))}</span> <button class="btn tiny" data-restore="${esc(f)}">Restore…</button></li>`).join("")}</ul>`:`<p class="muted small">None yet.</p>`}
    <div id="restore-confirm"></div></section>
  <section class="panel"><h2>Bring in your data</h2><p class="muted small">Use this once to move everything over from the old planner, or to restore a downloaded backup. A backup of what's here is taken first.</p>
    <input type="file" id="imp-file" accept=".json,application/json"><div id="imp-msg" class="small" style="margin-top:8px"></div></section>
  <section class="panel"><h2>Password</h2><p class="muted small">Change the password for ${esc(ME&&ME!=="dev"?ME:"your login")}. Your browser will ask you to sign in again.</p>
    ${ui.pw?`<div class="row"><input id="pw1" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" style="flex:1 1 220px"><button class="btn primary" data-act="pwSave">Save</button><button class="btn" data-act="pwCancel">Cancel</button></div>`:`<button class="btn" data-act="pwOpen">Change my password</button> <form method="post" action="/logout" style="display:inline"><button class="btn" type="submit">Sign out</button></form>`}</section>
  <section class="panel"><h2>Server status</h2><p class="muted small">What the server is running, and why an update or the sign-in switch hasn't happened. Updates arrive within about a minute of a change.</p>${statusHTML()}</section>
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
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&(e.target.id==="uu-name"||e.target.id==="uu-amt")){e.preventDefault();uuAdd()}
  else if(e.key==="Enter"&&e.target.dataset?.df&&e.target.tagName==="INPUT"){e.preventDefault();dealAdd()}});
document.addEventListener("input",e=>{const t=e.target,k=t.dataset?.df;if(!k||!ui.deal)return;ui.deal[k]=t.value;
  if(k==="name"){const hit=resolveIng(t.value).hit?.[1];if(hit){const want=hit.unit==="ks"?"ks":(ui.deal.u==="ks"?"kg":ui.deal.u);
    if(want!==ui.deal.u){ui.deal.u=want;const sel=document.querySelector('[data-df="u"]');if(sel)sel.value=want}}}});
document.addEventListener("click",e=>{const c=e.target.closest("[data-uuedit]");if(!c||e.target.closest("button"))return;const u=USEUP.find(x=>x.id===c.dataset.uuedit),x=u&&ING[u.id];if(!x)return;
  const n=$("#uu-name"),a=$("#uu-amt");n.value=x.name;a.value=u.amt>0?u.amt:"";a.focus();a.select();toast(`${x.name} loaded. Change the amount, then press Add`)});
document.addEventListener("change",e=>{const t=e.target;
  if(t.id==="has-thermo"){SAFETY={...(SAFETY||{}),thermometer:t.checked};render();putDoc("settings/safety",SAFETY);return}
  if(t.dataset.b&&t.dataset.s){const sl=PLAN[t.dataset.b][t.dataset.s];sl.meal=t.value;sl.fresh=false;reconcile();sl.fresh=!!(t.value&&FRESH&&CARRY_SLOTS.includes(t.dataset.s)&&isFreezerFit(MEALS[t.value])&&slotServ(t.dataset.b+"|"+t.dataset.s)!==PACK_SERV);savePlan();render();return}
  if(t.dataset.n){const[b,s]=t.dataset.n.split("|");setNeed(PLAN[b][s],s,parseInt(t.value)||0);savePlan();t.blur();render();return}
  if(t.dataset.prepdate!==undefined){if(/^\d{4}-\d\d-\d\d$/.test(t.value)){PREP=t.value;savePlan();render();toast(`Prep day ${fmtDate(PREP)}, eating ${fmtDate(dayDate(0))} – ${fmtDate(lastDay())}`)}return}
  libChange(t)});
document.addEventListener("click",e=>{const t=e.target.closest("button,[data-open],li[data-key]");if(!t)return;const d=t.dataset;
  if(d.tabgo)return go(d.tabgo);
  if(d.act==="reload"){reloadAll();return}
  if(d.lock){const[b,s]=d.lock.split("|");PLAN[b][s].locked=!PLAN[b][s].locked;savePlan();render();toast(PLAN[b][s].locked?"Locked: Suggest will leave this slot alone":"Unlocked")}
  else if(d.rand){const[b,s]=d.rand.split("|");if(PLAN[b][s].locked)return;const cat=SLOTS.find(x=>x[0]===s)[2];assignMeal(b,s,randomPick(cat,[PLAN[b][s].meal],d.rand,FRESH&&(cat==="lunch"||cat==="dinner")&&!planFresh(d.rand)));savePlan();render()}
  else if(d.slotfresh){const[b,s,on]=d.slotfresh.split("|");PLAN[b][s].fresh=on==="1";savePlan();render()}
  else if(d.nocarry){const[s,on]=d.nocarry.split("|");PLAN.block2[s].noCarry=on==="1";savePlan();render()}
  else if(d.uudel){uuSnap();USEUP=USEUP.filter(u=>u.id!==d.uudel);savePlan();render();toast("Removed. Tap Undo to bring it back")}
  else if(d.act==="uuUndo")uuUndo();
  else if(d.act==="uuAdd")uuAdd();
  else if(d.inc||d.dec){const[b,s]=(d.inc||d.dec).split("|");const sl=PLAN[b][s];if(d.inc)eatInc(sl,s);else eatDec(sl,s);savePlan();render()}
  else if(d.eat){const[b,s,dd,p]=d.eat.split("|");const e=PLAN[b][s].eat[+dd];e[PIDX[p]]=e[PIDX[p]]?0:1;savePlan();render()}
  else if(d.eatday){const[b,dd,p]=d.eatday.split("|");const ss=SLOTS.map(x=>x[0]).filter(s=>eaters(s).includes(p));const on=ss.some(s=>PLAN[b][s].eat[+dd][PIDX[p]]);
    for(const s of ss)PLAN[b][s].eat[+dd][PIDX[p]]=on?0:1;savePlan();render();toast(`${PEOPLE[PIDX[p]][1]} ${on?"not eating":"eating"} on ${fmtDate(dayDate(blockStart(b)+ +dd))}`)}
  else if(d.prep){PREP=d.prep;savePlan();render();toast(`Prep day ${fmtDate(PREP)}, eating ${fmtDate(dayDate(0))} – ${fmtDate(lastDay())}`)}
  else if(d.act==="nextWeek"){const t0=todayISO(),w=dow(t0);const nx=w===0||w===1?t0:addDays(t0,7-w);if(!confirm(`Start the next week with prep on ${fmtDate(nx)}? Ticks, At home amounts and who's eating are reset. Meals stay.`))return;startWeek(nx);render();toast(`Next week: prep ${fmtDate(nx)}`)}
  else if(d.act==="randAll"){randBlocks(["block1","block2"]);savePlan();render();const ids=[...new Set(activeDeals().map(x=>x.id))];toast("Suggested your week"+(ids.length?` · ${ids.filter(id=>dealPlanMeals(id).length).length} of ${ids.length} deals are in it`:""))}
  else if(d.act?.startsWith("rand:")){randBlocks([d.act.slice(5)]);savePlan();render()}
  else if(d.act==="reset"){const keep=PLAN;PLAN=emptyPlan();for(const[b] of BLOCKS)for(const[s] of SLOTS)PLAN[b][s].eat=JSON.parse(JSON.stringify(keep[b][s].eat||defaultEat(s)));for(const[b] of BLOCKS)for(const[s] of SLOTS)if(keep[b][s].locked)PLAN[b][s]={...keep[b][s]};EDITS={};CHECKED={};SWAPS={};DISMISSED={};MINCE="8020";FRESH=false;savePlan();render()}
  else if(d.mince){MINCE=d.mince;savePlan();render();toast(MINCE==="lean"?"Lean (5 %) ground beef this week":"80/20 ground beef: the recipes say when to drain it")}
  else if(d.fresh!==undefined){FRESH=d.fresh==="1";savePlan();render();toast(FRESH?"Buying fresh chicken: Suggest will include a fresh-chicken recipe":"Chicken from the freezer")}
  else if(d.ledit){ui.editHome=d.ledit;render();const i=$("#le-home");if(i){i.focus();i.select()}}
  else if(d.lsave){const i=$("#le-home");const val=czNum(i.value)||0;if(val<0){toast("Enter how much you have at home, or 0.");return}if(val===0)delete EDITS[d.lsave];else EDITS[d.lsave]={home:val};ui.editHome=null;savePlan();render()}
  else if(d.lremove){EDITS[d.lremove]={removed:true};ui.editHome=null;savePlan();render();toast("Off the list. It's under “Have it all at home” if you need it back.")}
  else if(d.lrestore){delete EDITS[d.lrestore];ui.editHome=null;savePlan();render()}
  else if(d.lcancel){ui.editHome=null;render()}
  else if(d.store){const[id,w]=d.store.split("|");setStore(id,w)}
  else if(d.act==="dealAdd")dealAdd();
  else if(d.act==="dealCancel"){ui.deal=newDeal();render()}
  else if(d.act==="dealUndo")dealUndo();
  else if(d.act==="dealClearOld"){dealSnap();DEALS=DEALS.filter(dealActive);ui.deal&&(ui.deal.edit=null);saveDeals();render();toast("Expired deals cleared")}
  else if(d.dealadd)dealPlace(d.dealadd);
  else if(d.dealrm)dealUnplace(d.dealrm);
  else if(d.dealmore){ui.dealMore[d.dealmore]=!ui.dealMore[d.dealmore];render()}
  else if(d.dealdel!==undefined){dealSnap();DEALS.splice(+d.dealdel,1);ui.deal&&(ui.deal.edit=null);saveDeals();render();toast("Removed. Tap Undo to bring it back")}
  else if(d.dealedit!==undefined){const x=DEALS[+d.dealedit];if(!x)return;const n=v=>v?String(v).replace(".",","):"";
    ui.deal={name:ING[x.id]?.name||x.id,store:x.store,price:n(x.price),amt:n(x.amt)||"1",u:x.u,was:n(x.was),until:x.until,note:x.note||"",edit:+d.dealedit};render();window.scrollTo({top:0})}
  else if(d.dealpick!==undefined){const[id,st]=d.dealpick.split("|");if(st)DEALPICK[id]=st;else delete DEALPICK[id];saveDeals();render();toast(st?`${ING[id]?.name||id} will be bought at ${st}`:`${ING[id]?.name||id} is back on the online list`)}
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
  else if(d.act==="statusRefresh"){ui.status=null;render();loadStatus()}
  else if(d.act==="backupNow"){fetch("/api/backup-now",{method:"POST"}).then(()=>{ui.backups=null;render();toast("Backup saved on the server")})}
  else if(d.restore){$("#restore-confirm").innerHTML=`<div class="confirm" style="margin-top:8px"><span>Replace everything with this backup? (A backup of the current data is saved first.)</span><button class="btn danger" data-restoreyes="${esc(d.restore)}">Restore</button></div>`}
  else if(d.restoreyes){fetch("/api/restore/"+d.restoreyes,{method:"POST"}).then(async r=>{if(!r.ok){toast("Restore failed");return}ui.backups=null;await reloadAll();toast("Restored")})}
  else if(d.act==="pwOpen"){ui.pw=true;render()}
  else if(d.act==="pwCancel"){ui.pw=false;render()}
  else if(d.act==="pwSave"){const pw=$("#pw1").value;fetch("/api/password",{method:"POST",headers:jhead,body:JSON.stringify({password:pw})}).then(async r=>{const j=await r.json();if(!r.ok){toast(j.error||"Couldn't change the password");return}ui.pw=false;render();toast("Password changed. Your other devices will need to sign in again.")})}
  else if(d.key){const k=d.key;CHECKED={...CHECKED};if(CHECKED[k])delete CHECKED[k];else CHECKED[k]=true;t.classList.toggle("done",!!CHECKED[k]);savePlan()}
  else libClick(t,d)});

window.addEventListener("beforeunload",e=>{if(dirty()){e.preventDefault();e.returnValue=""}});
(async()=>{renderTabs();try{await reloadAll();if(TESCO_IN){tab="prices";await takeTescoResult(TESCO_IN)}}catch(e){$("#status").textContent="Couldn't load your data. Check your connection and reload."}})();

/* ---------- ingredient picker: matches without accents or word order, so "kureci prsa" and "prsa kur" both find Kuřecí prsa ---------- */
function ingMatches(q){const ws=fold(q).trim().split(/[^a-z0-9%]+/).filter(Boolean);if(!ws.length)return[];const fq=ws.join(" ");
  return Object.entries(ING).map(([id,x])=>{const n=fold(x.name),words=n.split(/[^a-z0-9%]+/);if(!ws.every(w=>n.includes(w)))return null;
    const score=n===fq?0:n.startsWith(fq)?1:ws.every(w=>words.some(v=>v.startsWith(w)))?2:3;return{id,x,score}}).filter(Boolean)
    .sort((a,b)=>a.score-b.score||a.x.name.localeCompare(b.x.name,"cs"))}
function resolveIng(q){const m=ingMatches(q);if(!m.length)return{hit:null,count:0};
  const exact=m.filter(r=>r.score===0);if(exact.length===1)return{hit:[exact[0].id,exact[0].x],count:1};
  return m.length===1?{hit:[m[0].id,m[0].x],count:1}:{hit:null,count:m.length}}
const SUG={el:null,input:null,items:[],i:-1,quiet:false};
function sugBox(){if(!SUG.el){SUG.el=document.createElement("ul");SUG.el.className="ingsug";SUG.el.setAttribute("role","listbox");SUG.el.hidden=true;document.body.appendChild(SUG.el);
  SUG.el.addEventListener("mousedown",e=>{const li=e.target.closest("li[data-i]");if(li){e.preventDefault();sugPick(+li.dataset.i)}})}return SUG.el}
function sugHide(){if(SUG.el)SUG.el.hidden=true;SUG.items=[];SUG.i=-1}
function sugShow(inp){const el=sugBox();SUG.input=inp;SUG.items=ingMatches(inp.value).slice(0,8);SUG.i=SUG.items.length?0:-1;
  if(!SUG.items.length||(SUG.items.length===1&&fold(SUG.items[0].x.name)===fold(inp.value.trim()))){sugHide();return}
  el.innerHTML=SUG.items.map((r,i)=>`<li role="option" data-i="${i}" aria-selected="${i===SUG.i}">${esc(r.x.name)}</li>`).join("");
  const rc=inp.getBoundingClientRect();el.style.left=(rc.left+scrollX)+"px";el.style.top=(rc.bottom+scrollY+2)+"px";el.style.width=Math.max(rc.width,220)+"px";el.hidden=false}
function sugMove(d){if(!SUG.items.length)return;SUG.i=(SUG.i+d+SUG.items.length)%SUG.items.length;SUG.el.querySelectorAll("li").forEach((li,i)=>li.setAttribute("aria-selected",i===SUG.i))}
function sugPick(i){const r=SUG.items[i],inp=SUG.input;if(!r||!inp)return;inp.value=r.x.name;sugHide();SUG.quiet=true;inp.dispatchEvent(new Event("input",{bubbles:true}));SUG.quiet=false;inp.focus()}
document.addEventListener("input",e=>{if(e.target.matches?.("[data-ingpick]")&&!SUG.quiet)sugShow(e.target)});
document.addEventListener("focusin",e=>{if(e.target.matches?.("[data-ingpick]")&&e.target.value.trim())sugShow(e.target)});
document.addEventListener("focusout",e=>{if(e.target.matches?.("[data-ingpick]"))setTimeout(()=>{if(document.activeElement!==SUG.input)sugHide()},120)});
document.addEventListener("keydown",e=>{if(!e.target.matches?.("[data-ingpick]")||!SUG.el||SUG.el.hidden)return;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();sugMove(e.key==="ArrowDown"?1:-1)}
  else if(e.key==="Enter"&&SUG.i>=0){e.preventDefault();e.stopImmediatePropagation();sugPick(SUG.i)}
  else if(e.key==="Escape"){sugHide()}},true);
window.addEventListener("scroll",()=>{if(SUG.el&&!SUG.el.hidden&&SUG.input)sugShow(SUG.input)},{passive:true});
