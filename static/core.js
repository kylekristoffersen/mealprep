/* Meal Prep Planner: shared logic (used by the main app and the read-only Cook page).
   Numbers are shown with a decimal comma (3,6), as in Czech. */
"use strict";
const SLOTS=[["breakfast","Breakfast","breakfast"],["lunch","Lunch","lunch"],["dinner","Dinner","dinner"],["snack1","Snack 1","snack"],["snack2","Snack 2","snack"]];
const BLOCKS=[["block1","Block 1","Days 1–3"],["block2","Block 2","Days 4–6"]];
const CATS=[["breakfast","Breakfast"],["lunch","Lunch"],["dinner","Dinner"],["snack","Snacks"]];
const DEFAULT_SERV={breakfast:6,lunch:6,dinner:6,snack1:3,snack2:3};
const PACK_SERV=6, CARRY_SLOTS=["lunch","dinner"];
const FREEZER_PACKS={"kureci-prsa":[900,600]};
const LEAN_MINCE="hovezi-mlete-libove-5", FAT_MINCE="hovezi-mlete-maso-vyberove";

let ING={}, MEALS={}, TARGETS=null, SAFETY=null, SHOPSET=null;
let PLAN=emptyPlan(), SWAPS={}, DISMISSED={}, EDITS={}, CHECKED={}, USEUP=[], MINCE="8020", FRESH=false, LISTWEEK=null, CARRY={};

/* ---------- small helpers ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fold=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const cz=(n,dec)=>{const v=dec==null?+(+n).toFixed(2):+(+n).toFixed(dec);return String(v).replace(".",",")};
const czNum=s=>parseFloat(String(s).replace(/[\s ]/g,"").replace(",","."));
const todayISO=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const addDays=(iso,n)=>{const d=new Date(iso+"T12:00:00");d.setDate(d.getDate()+n);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const weekKey=()=>{const t=todayISO();return addDays(t,-new Date(t+"T12:00:00").getDay())}; // the Sunday that starts this week
const slug=s=>fold(s).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50);
const fmtAmt=(a,unit)=>unit==="ks"?`${cz(a,1)} ks`:a<10?`${cz(a,1)} g`:a>=1000?`${cz(a/1000,2)} kg`:`${Math.round(a)} g`;
const fmtPlain=(a,unit)=>unit==="ks"?cz(a,1):String(Math.round(a));
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;

function emptyPlan(){const p={};for(const[b] of BLOCKS){p[b]={};for(const[s] of SLOTS)p[b][s]={meal:"",n:DEFAULT_SERV[s],need:DEFAULT_SERV[s]}}return p}
function mergePlan(p){const base=emptyPlan();for(const[b] of BLOCKS)for(const[s] of SLOTS)if(p?.[b]?.[s]){base[b][s]={...base[b][s],...p[b][s]};if(p[b][s].need==null)base[b][s].need=base[b][s].n}return base}

/* ---------- nutrition ---------- */
function macros(meal){const t={kcal:0,p:0,c:0,f:0,fib:0};if(!meal)return t;
  for(const[id,a] of meal.items||[]){const x=ING[id];if(!x)continue;const k=x.unit==="ks"?a:a/100;for(const key in t)t[key]+=(+x[key]||0)*k}return t}
function rangeStatus(v,lo,hi){if(v>=lo&&v<=hi)return"on";const tol=.1*((lo+hi)/2);return(v>=lo-tol&&v<=hi+tol)?"near":"off"}
const mealTarget=cat=>TARGETS?.meals?.[cat]||null;
function snackTarget(){if(!TARGETS)return null;const m=TARGETS.meals,k=TARGETS.kyle;const mid=r=>(r[0]+r[1])/2;
  const mains=["breakfast","lunch","dinner"];const sum=key=>mains.reduce((s,c)=>s+mid(m[c][key]),0);
  return{kcal:(mid(k.kcal)-sum("kcal"))/2,p:(k.p-sum("p"))/2,c:(k.c-sum("c"))/2,f:(k.f-sum("f"))/2}}
function chipFor(meal){const t=macros(meal);const tg=mealTarget(meal.cat);let st="";
  if(tg)st=rangeStatus(t.kcal,tg.kcal[0],tg.kcal[1]);else{const s=snackTarget();if(s)st=rangeStatus(t.kcal,s.kcal*.85,s.kcal*1.15)}
  return`<span class="chip ${st}" title="${st==="on"?"Hits the target":st==="near"?"Within 10% of target":st?"Off target":""}">${Math.round(t.kcal)} kcal</span><span class="chip">P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</span>`}

/* ---------- recipe steps that follow the servings ----------
   {=ingredient-id}  total of that ingredient for the servings cooked
   {q:1 tsp}         an amount written for stepBatch servings (default 4), scaled to the servings cooked and by stepScale */
const FRACS={"½":.5,"¼":.25,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125};
function parseQty(t){const m=String(t).trim().match(/^(\d+(?:[.,]\d+)?)?\s*([½¼¾⅓⅔⅛])?\s*(.*)$/);if(!m||(!m[1]&&!m[2]))return null;return{v:(m[1]?parseFloat(m[1].replace(",",".")):0)+(m[2]?FRACS[m[2]]:0),u:m[3].trim()}}
function fmtQty(v,u){if(/^(tsp|tbsp|lžič|lžíc|cup)/i.test(u)||!u){const opts=[[0,""],[.25,"¼"],[1/3,"⅓"],[.5,"½"],[2/3,"⅔"],[.75,"¾"],[1,""]];let w=Math.floor(v),f=v-w;
    const best=opts.reduce((a,b)=>Math.abs(b[0]-f)<Math.abs(a[0]-f)?b:a);if(best[0]===1)w++;const txt=`${w||(best[1]?"":"0")}${best[0]===1?"":best[1]}`;return txt==="0"?`a pinch${u?" of":""}`:`${txt}${u?" "+u:""}`}
  const step=v<20?1:v<100?5:v<500?10:50;return`${Math.round(v/step)*step} ${u}`}
function renderStep(txt,m,n){const k=n/(m.stepBatch||4)*(m.stepScale||1);
  return String(txt).replace(/\{=([a-z0-9-]+)\}/g,(all,id)=>{const it=(m.items||[]).find(x=>x[0]===id);return it&&ING[id]?fmtAmt(it[1]*n,ING[id].unit):all})
    .replace(/\{q:([^}]+)\}/g,(all,q)=>{const p=parseQty(q);return p?fmtQty(p.v*k,p.u):q})}

/* ---------- this week's ground beef: lean (5 %) or the usual 80/20, counted browned and drained ---------- */
const minceMode=()=>MINCE==="lean"?"lean":"8020";
function effMeal(m){if(!m)return m;const mode=minceMode();const from=mode==="lean"?FAT_MINCE:LEAN_MINCE,to=mode==="lean"?LEAN_MINCE:FAT_MINCE;
  if(!(m.items||[]).some(([i])=>i===from))return m;
  const items=[];for(const[i,a] of m.items){const id=i===from?to:i;const x=items.find(y=>y[0]===id);if(x)x[1]+=a;else items.push([id,a])}
  const tok=t=>String(t).split(`{=${from}}`).join(`{=${to}}`);let done=mode!=="8020";const DR=" (80/20 mince this week: as soon as it's browned, before anything else goes in, tip it into a sieve to drain off the fat, then return it to the pan.)";
  const mark=st=>{const t=st.map(tok);if(done)return t;let i=t.findIndex(x=>x.includes(`{=${to}}`));if(i<0)i=t.findIndex(x=>/\bmince|ground beef|mlet|mělněn/i.test(x));if(i>=0){done=true;t[i]+=DR}return t};
  let prepSteps=mark(m.prepSteps||[]),daySteps=mark(m.daySteps||[]);
  if(!done){const tip="This week's mince is 80/20: brown it first, then tip it into a sieve and let the fat drain off before it goes into the dish.";if(m.prep==="fresh")daySteps=[tip,...daySteps];else prepSteps=[tip,...prepSteps]}
  return{...m,items,prepSteps,daySteps,minceSwap:mode}}
const PM=id=>effMeal(MEALS[id]);
const isFresh=m=>m?.chicken==="fresh";

/* ---------- portions and carry-over ----------
   "need" = portions eaten in that block (the number you set). "n" = what gets cooked, worked out here.
   A freezer-pack recipe always cooks a whole pack (6). Spare portions from Block 1 go to the same meal in Block 2. */
function isFreezerFit(m){if(!m||isFresh(m))return false;const a=(m.items||[]).find(x=>x[0]==="kureci-prsa");if(!a)return false;const sizes=SHOPSET?.freezerPacks?.["kureci-prsa"]||FREEZER_PACKS["kureci-prsa"];return sizes.some(v=>Math.abs(a[1]*PACK_SERV-v)<1)}
const packBound=sl=>{const m=MEALS[sl?.meal];return!!m&&isFreezerFit(m)&&!sl.fresh};
const needOf=sl=>sl?.need??sl?.n??PACK_SERV;
function block1Spare(s){const a=PLAN.block1?.[s];return packBound(a)&&needOf(a)<PACK_SERV?PACK_SERV-needOf(a):0}
function reconcile(){CARRY={};
  for(const[b] of BLOCKS)for(const[s] of SLOTS){const sl=PLAN[b][s];if(sl.need==null)sl.need=sl.n??DEFAULT_SERV[s];sl.n=sl.need}
  for(const s of CARRY_SLOTS){const a=PLAN.block1[s],z=PLAN.block2[s];const zMeal=!!MEALS[z.meal];
    const spare=block1Spare(s);if(spare)a.n=PACK_SERV;
    let used=0;if(spare&&zMeal&&!z.noCarry&&!packBound(z)){used=Math.min(spare,z.need);z.n=z.need-used}
    let extra2=0;if(packBound(z)&&z.need<PACK_SERV){z.n=PACK_SERV;extra2=PACK_SERV-z.need}
    CARRY[s]={spare,used,toFreezer:spare-used,extra2,zEmpty:!zMeal,blocked:!!spare&&zMeal&&!z.noCarry&&packBound(z)}}}
const packG=m=>{const a=(m?.items||[]).find(x=>x[0]==="kureci-prsa");return a?Math.round(a[1]*PACK_SERV):0};
function spareText(b,s){const c=CARRY[s];if(!c||!CARRY_SLOTS.includes(s))return"";const sl=PLAN[b][s];
  if(b==="block1"&&c.spare)return` (eat ${sl.need}, freeze ${c.spare}${c.used?` for Block 2`:" spare"})`;
  if(b==="block2"&&c.used)return` (+ ${c.used} from Block 1, frozen: thaw in the fridge the night before)`;
  if(b==="block2"&&c.extra2)return` (eat ${sl.need}, freeze ${c.extra2} spare)`;return""}
function packNote(id,total){const sizes=SHOPSET?.freezerPacks?.[id]||FREEZER_PACKS[id];if(!sizes||!(total>0))return"";const combos=[];
  const rec=(i,n,sum,used)=>{if(sum>=total-10){combos.push({sum,used:[...used]});return}if(n>=4)return;for(let k=i;k<sizes.length;k++){used.push(sizes[k]);rec(k,n+1,sum+sizes[k],used);used.pop()}};rec(0,0,0,[]);
  combos.sort((a,b)=>a.sum-b.sum||a.used.length-b.used.length);const c=combos[0];if(!c)return"";const cnt={};for(const v of c.used)cnt[v]=(cnt[v]||0)+1;
  const left=Math.round(c.sum-total);return` (thaw ${Object.entries(cnt).sort((a,b)=>b[0]-a[0]).map(([v,n])=>`${n} × ${v} g`).join(" + ")}${c.used.length>1?` = ${fmtAmt(c.sum,"g")}`:""}${left>10?`, ${left} g spare`:""})`}
const slotServ=k=>{if(!k)return PACK_SERV;const[b,s]=k.split("|");const sl=PLAN[b]?.[s];if(!sl)return PACK_SERV;const need=needOf(sl);
  if(!CARRY_SLOTS.includes(s))return need;if(b==="block1")return need<=PACK_SERV?PACK_SERV:need;
  return sl.noCarry?need:need-Math.min(block1Spare(s),need)};

/* ---------- use-up list ---------- */
function uuStatus(u){let t=0;const names=[];for(const[b] of BLOCKS)for(const[s] of SLOTS){const sl=PLAN[b][s];const m=PM(sl.meal);const a=(m?.items||[]).find(x=>x[0]===u.id);if(a){t+=a[1]*sl.n;names.push(m.name)}}
  return{t,names:[...new Set(names)],done:u.amt>0&&t>=u.amt}}
function mealUses(m,open){if(!m)return[];return USEUP.filter(u=>(m.items||[]).some(([i])=>i===u.id)&&!(open&&uuStatus(u).done)).map(u=>u.id)}
function editFor(pre,id,reg){const e=EDITS[pre+id];if(e)return e;const u=USEUP.find(x=>x.id===id&&x.amt>0);if(!u)return null;return pre==="r:"||!(id in reg)?{home:u.amt,useup:true}:null}

/* ---------- suggest (randomise) ---------- */
const mealsFor=cat=>Object.entries(MEALS).filter(([,m])=>m.cat===cat).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
const planFresh=skip=>{let n=0;for(const[b] of BLOCKS)for(const[s] of SLOTS){if(skip===b+"|"+s)continue;if(isFresh(MEALS[PLAN[b][s].meal]))n++}return n};
function randomPick(cat,avoid,slotKey,wantFresh){const all=mealsFor(cat).map(e=>e[0]);const list=all.filter(id=>!avoid.includes(id));let pool=list.length?list:all;
  if(wantFresh){const fr=pool.filter(id=>isFresh(MEALS[id]));if(fr.length)return fr[Math.floor(Math.random()*fr.length)]}
  if(!FRESH){const nf=pool.filter(id=>!isFresh(MEALS[id]));if(nf.length)pool=nf}
  // a slot that isn't 6 servings skips freezer-pack recipes, so no pack is left part-used
  if(slotServ(slotKey)!==PACK_SERV&&!FRESH){const np=pool.filter(id=>!isFreezerFit(MEALS[id]));if(np.length)pool=np}
  const weighted=[];for(const id of pool){const n=1+4*Math.min(2,mealUses(MEALS[id],true).length);for(let i=0;i<n;i++)weighted.push(id)}
  return weighted[Math.floor(Math.random()*weighted.length)]||""}
function assignMeal(b,s,id){const sl=PLAN[b][s];sl.meal=id||"";sl.fresh=!!(id&&FRESH&&CARRY_SLOTS.includes(s)&&isFreezerFit(MEALS[id])&&slotServ(b+"|"+s)!==PACK_SERV);reconcile()}
function randBlocks(bl){for(const b of bl)for(const[s] of SLOTS)if(!PLAN[b][s].locked){PLAN[b][s].meal="";PLAN[b][s].fresh=false}reconcile();
  let freshSlot=null;if(FRESH&&!planFresh())for(const s of["lunch","dinner"])for(const b of bl)if(!freshSlot&&!PLAN[b][s].locked)freshSlot=b+"|"+s;
  for(const b of bl)for(const[s,,cat] of SLOTS){if(PLAN[b][s].locked)continue;const other=BLOCKS.map(x=>x[0]).filter(x=>x!==b).map(x=>PLAN[x][s].meal);const sib=s==="snack1"?[PLAN[b].snack2.meal]:s==="snack2"?[PLAN[b].snack1.meal]:[];
    assignMeal(b,s,randomPick(cat,[...other,...sib],b+"|"+s,freshSlot===b+"|"+s))}}
function chickenSplit(){let fz=0,fr=0;for(const[b] of BLOCKS)for(const[s] of SLOTS){const m=PM(PLAN[b][s].meal),sl=PLAN[b][s];if(!m)continue;const a=(m.items||[]).find(x=>x[0]==="kureci-prsa");if(!a)continue;const g=a[1]*sl.n;if(isFresh(m)||sl.fresh)fr+=g;else fz+=g}return{fz,fr}}

/* ---------- shopping ---------- */
const isLidlPick=id=>!!SHOPSET?.lidlPick?.[id], isKauflandPick=id=>!!SHOPSET?.kauflandPick?.[id];
function shoppingData(){const reg={},b2={},spice={};
  for(const[b] of BLOCKS)for(const[s] of SLOTS){const sel=PLAN[b][s];const m=PM(sel.meal);if(!m)continue;
    for(const[id,a] of m.items||[]){const x=ING[id];if(!x)continue;const tgt=x.spice?spice:(b==="block2"&&x.bakery)?b2:reg;tgt[id]=(tgt[id]||0)+a*sel.n}}
  const removed=[];const orig={reg:{...reg},b2:{...b2}};
  const apply=(o,pre)=>{for(const id of Object.keys(o)){const e=editFor(pre,id,orig.reg);if(!e)continue;const plan=o[id];
    const buy=e.removed?0:e.home!=null?Math.max(0,plan-e.home):(e.amt>0?e.amt:plan);
    if(buy<=0){removed.push({id,useup:!!e.useup,key:pre+id,name:ING[id].name,amt:plan,unit:ING[id].unit});delete o[id]}else o[id]=buy}};
  apply(reg,"r:");apply(b2,"b:");
  const byName=(x,y)=>x.name.localeCompare(y.name,"cs");
  const toList=(o,pre,src)=>Object.entries(o).map(([id,a])=>({id,key:pre+id,name:ING[id].name,amt:a,orig:src[id],home:editFor(pre,id,orig.reg)?src[id]-a:0,edited:!!EDITS[pre+id],unit:ING[id].unit,b2:pre==="b:"})).sort(byName);
  const all=[...toList(reg,"r:",orig.reg),...toList(b2,"b:",orig.b2)];
  const kaufland=all.filter(x=>isKauflandPick(x.id)).sort(byName);
  const lidl=all.filter(x=>isLidlPick(x.id)&&!isKauflandPick(x.id)).sort(byName);
  const away=id=>isLidlPick(id)||isKauflandPick(id);
  return{reg:toList(reg,"r:",orig.reg).filter(x=>!away(x.id)),b2:toList(b2,"b:",orig.b2).filter(x=>!away(x.id)),lidl,kaufland,
    spices:Object.entries(spice).map(([id,a])=>({id,name:ING[id].name,amt:a})).sort(byName),removed:removed.sort(byName)}}

// Plain-text list for the Tesco skill or for pasting into a chat. One line per item: name, amount, unit.
function listText(){const{reg,b2,lidl,kaufland}=shoppingData();const line=x=>`${x.name}\t${fmtPlain(x.amt,x.unit)}\t${x.unit==="ks"?"ks":"g"}`;let t="";
  const sec=(title,a)=>{if(a.length)t+=(t?"\n":"")+title+"\n"+a.map(line).join("\n")+"\n"};
  sec("ONLINE (Rohlík / Košík / Tesco)",reg);sec("ONLINE, BLOCK 2 BAKERY (buy fresh)",b2);sec("LIDL",lidl);sec("KAUFLAND",kaufland);return t.trim()}
function planText(){let t="";for(const[s,label] of SLOTS){const f=b=>{const m=MEALS[PLAN[b][s].meal];return`${label}: ${m?m.name:"None"} (${PLAN[b][s].n})`};t+=`${f("block1")}\t\t${f("block2")}\n`}return t.trim()}

/* ---------- loading from the server's documents ---------- */
function loadDocs(docs){ING=docs["lib/ingredients"]?.data?.items||{};MEALS={};
  for(const[p,d] of Object.entries(docs))if(p.startsWith("meals/"))MEALS[p.slice(6)]=d.data;
  TARGETS=docs["settings/targets"]?.data||null;SAFETY=docs["settings/safety"]?.data||null;SHOPSET=docs["settings/shopping"]?.data||null;
  const d=docs["state/plan"]?.data;const cl=o=>JSON.parse(JSON.stringify(o||{}));
  if(d){PLAN=mergePlan(d.plan);SWAPS=cl(d.swaps);DISMISSED=cl(d.dismissed);EDITS=cl(d.edits);CHECKED=cl(d.checked);MINCE=d.mince==="lean"?"lean":"8020";FRESH=!!d.freshChicken;USEUP=Array.isArray(d.useup)?cl(d.useup):[];LISTWEEK=d.listWeek||null}
  else{PLAN=emptyPlan();SWAPS={};DISMISSED={};EDITS={};CHECKED={};MINCE="8020";FRESH=false;USEUP=[];LISTWEEK=null}
  reconcile()}
const planDoc=()=>({plan:PLAN,swaps:SWAPS,dismissed:DISMISSED,edits:EDITS,checked:CHECKED,mince:MINCE,freshChicken:FRESH,useup:USEUP,listWeek:LISTWEEK||weekKey()});

/* ---------- Cook views (shared with the read-only Cook page) ---------- */
const who=s=>s.startsWith("snack")?"Kyle":"Kyle & Annie";
function slotRows(b){return SLOTS.map(([s,label])=>({s,label,sel:PLAN[b][s],m:PM(PLAN[b][s].meal)})).filter(x=>x.m)}
function prepHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;const ahead=ms.filter(x=>x.m.prep!=="fresh"),fresh=ms.filter(x=>x.m.prep==="fresh");
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name} prep</h2><span class="tape">${days}</span></div>
    ${ahead.length?ahead.map(x=>`<div class="dish"><div class="row"><h3>${esc(x.m.name)}</h3><span class="prep ${x.m.prep}">${x.m.prep}</span></div>
      <p class="muted small">${x.sel.n} servings${esc(spareText(b,x.s))}${x.m.keeps?` · keeps ${esc(x.m.keeps)}`:""} · ${x.label}, ${who(x.s)}</p>
      <ul class="ings">${(x.m.items||[]).filter(([id])=>ING[id]).map(([id,a])=>`<li><span>${esc(ING[id].name)}${esc((isFresh(x.m)||x.sel.fresh)&&id==="kureci-prsa"?" (buy fresh)":packNote(id,a*x.sel.n))}</span><b>${fmtAmt(a*x.sel.n,ING[id].unit)}</b></li>`).join("")}</ul>
      <ol class="steps">${(x.m.prepSteps||[]).map(s=>`<li>${esc(renderStep(s,x.m,x.sel.n))}</li>`).join("")}</ol>${x.m.note?`<p class="note">${esc(x.m.note)}</p>`:""}</div>`).join(""):`<p class="muted">Nothing to cook ahead for this block.</p>`}
    ${fresh.length?`<p class="muted" style="margin-top:14px">Made on the day: ${fresh.map(x=>esc(x.m.name+spareText(b,x.s))).join(", ")}.</p>`:""}</section>`}
  return html||`<div class="empty">Choose meals on the Plan tab to see what to cook on prep day.</div>`}
function eachDayHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name}</h2><span class="tape">${days}</span></div>
    ${ms.map(x=>{const m=x.m;const steps=m.daySteps||[];return`<div class="dish"><div class="row"><span class="slotname">${x.label}</span><h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span></div>
      <p class="muted small">${who(x.s)} · ${x.sel.n} servings${esc(spareText(b,x.s))}</p>
      ${m.prep==="fresh"?`<ul class="ings">${(m.items||[]).filter(([id])=>ING[id]).map(([id,a])=>`<li><span>${esc(ING[id].name)}</span><b>${fmtAmt(a,ING[id].unit)}</b></li>`).join("")}</ul>`:`<p class="muted small">Cooked on prep day.</p>`}
      ${steps.length?`<h4>${m.prep==="fresh"?"Method":"Before serving"}</h4><ol class="steps">${steps.map(s=>`<li>${esc(renderStep(s,m,1))}</li>`).join("")}</ol>`:""}
      ${m.prep==="fresh"&&m.note?`<p class="note">${esc(m.note)}</p>`:""}</div>`}).join("")}</section>`}
  return html||`<div class="empty">Choose meals on the Plan tab and each day's steps appear here.</div>`}
function weekRecipesHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name}</h2><span class="tape">${days}</span></div>
    ${ms.map(x=>{const m=x.m,per=x.sel.n,t=macros(m);
      return`<article class="dish"><div class="row"><span class="slotname">${x.label}</span><h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span></div>
      <p class="muted small">${per} servings${m.keeps?` · keeps ${esc(m.keeps)}`:""} · per serving ${Math.round(t.kcal)} kcal, P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</p>
      <div class="scroll"><table><thead><tr><th>Ingredient</th><th class="num">1 serving</th><th class="num">${per} servings</th></tr></thead><tbody>${(m.items||[]).filter(([id])=>ING[id]).map(([id,a])=>`<tr><td>${esc(ING[id].name)}</td><td class="num">${fmtAmt(a,ING[id].unit)}</td><td class="num">${fmtAmt(a*per,ING[id].unit)}</td></tr>`).join("")}</tbody></table></div>
      ${(m.prepSteps||[]).length?`<h4>On prep day</h4><ol class="steps">${m.prepSteps.map(s=>`<li>${esc(renderStep(s,m,per))}</li>`).join("")}</ol>`:""}
      ${(m.daySteps||[]).length?`<h4>${m.prep==="fresh"?"Method":"On the day"}</h4><ol class="steps">${m.daySteps.map(s=>`<li>${esc(renderStep(s,m,per))}</li>`).join("")}</ol>`:""}
      ${m.note?`<p class="note">${esc(m.note)}</p>`:""}</article>`}).join("")}</section>`}
  return html||`<div class="empty">Choose meals on the Plan tab and their recipes appear here.</div>`}

const SAFETY_TABLE=[
 ["Chicken and other poultry (including ground)","Cut into thin, even pieces and cook through. Slice the thickest piece open: no pink, juices clear, flesh opaque and firm all the way through. Prefer small pieces or chicken simmered in sauce over a thick pan-seared breast.","74 °C in the thickest part."],
 ["Ground beef, pork, lamb, veal","Crumble and cook until no pink remains and it is well browned throughout. Prefer crumbled mince in a sauce over thick patties.","71 °C in the thickest part."],
 ["Whole cuts of beef, pork, lamb, veal","Hard to judge by eye. Slice thinly or cut into strips and cook through. Avoid serving thick cuts pink until you have a thermometer.","63 °C in the thickest part, then rest 3 minutes."],
 ["Fish and shellfish","Flesh is opaque and flakes easily with a fork.","63 °C in the thickest part."],
 ["Egg dishes","Set firm throughout, no runny egg.","71 °C."],
 ["Reheated leftovers","Steaming hot all the way through. Stir halfway when using the microwave, and reheat only once.","74 °C."]];
const hasThermo=()=>!!SAFETY?.thermometer;
function safetyHTML(withToggle){const th=hasThermo();
  return`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between;gap:10px"><div><h2 style="margin:0">Food safety</h2><p class="muted small" style="margin:2px 0 0;max-width:62ch">Safe cooking, cooling and storage for batch prep. Targets follow USDA food safety guidance.</p></div>
    ${withToggle?`<label class="row" style="gap:8px"><input type="checkbox" id="has-thermo" ${th?"checked":""}> I have a food thermometer</label>`:""}</div>
    <p class="note" style="margin-top:12px">${th?"Thermometer mode. Measure in the thickest part of the food and confirm the target temperature before eating.":"No thermometer. These are the best checks available without one, not proof of doneness. A basic instant-read thermometer is the only way to verify chicken, so it is worth buying."}</p></section>
  <section class="panel" style="margin-bottom:16px"><h2>Cooking</h2><div class="scroll"><table><thead><tr><th>Food</th><th>${th?"Target temperature":"How to check without a thermometer"}</th></tr></thead><tbody>
  ${SAFETY_TABLE.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(th?r[2]:r[1])}</td></tr>`).join("")}</tbody></table></div></section>
  <div class="grid2" style="gap:16px;margin-bottom:16px"><section class="panel"><h2>Cooling and storage</h2><ul class="plain">
    <li>Cool batch food fast: divide into shallow containers (no more than about 4 cm deep) rather than leaving a deep pot to cool.</li>
    <li>Refrigerate within 2 hours (1 hour above 32 °C). The danger zone is 4–60 °C.</li>
    <li>Keep the fridge at 4 °C or colder.</li><li>Cooked leftovers keep 3–4 days in the fridge and 3–4 months in the freezer.</li>
    <li>Thaw in the fridge, not on the counter.</li><li>Reheat leftovers until steaming hot all the way through, and only once.</li></ul></section>
  <section class="panel"><h2>Cooked rice</h2><p style="margin:8px 0 0">Rice spores survive cooking, and the toxin that forms if rice sits warm is not destroyed by reheating. Cool it quickly, ideally within 1 hour, spread thin in a shallow container, and refrigerate straight away.</p>
    <p class="note" style="margin-top:10px">Number not confirmed. Sources disagree on how many days cooked rice keeps in the fridge. Check the official guidance (SZPI or UK FSA) before relying on a figure.</p></section></div>`}
