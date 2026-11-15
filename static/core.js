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
let DEALS=[], DEALPICK={};
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
/* {@ingredient-id}  prints nothing; only tells the Cook page that this step uses that ingredient (for crossing it off).
   {=id:40%} {=id:1/3} {=id:rest}  a portion of the ingredient: that share of the total, or the total minus every other portion
     in the meal's steps. A portion token also tells the Cook page the ingredient is split, so it stays part-used until the rest goes in.
   {=id|tbsp} {=id|tsp} {=id|ml} {=id|spoon} {=id|cloves}  show the amount in spoons (spoon picks tbsp or tsp), millilitres or garlic cloves too (also with a portion: {=id:rest|tbsp}).
   An ingredient listed twice in a meal: {=id} shows the total, unless the steps have exactly one {=id} per row, in which case
   the first token shows the first row's amount, the second the second's, and so on (occ carries the count across steps). */
const TOK=/\{=([a-z0-9-]+)(?::([^}|]+))?(?:\|(tbsp|tsp|ml|spoon|cloves))?\}/g;
const allSteps=m=>[...(m.prepSteps||[]),...(m.daySteps||[])];
const tokensOf=st=>[...String(st).matchAll(TOK)].map(t=>({id:t[1],part:(t[2]||"").trim(),unit:t[3]||""}));
const tokenCount=(m,id)=>allSteps(m).reduce((c,st)=>c+tokensOf(st).filter(t=>t.id===id&&!t.part).length,0);
function occFor(m,phase){const o={};if(phase==="day")for(const st of m.prepSteps||[])for(const t of tokensOf(st))if(!t.part)o[t.id]=(o[t.id]||0)+1;return o}
function partShare(p){p=String(p).trim().replace(",",".");let m;if((m=p.match(/^(\d+(?:\.\d+)?)\s*%$/)))return+m[1]/100;if((m=p.match(/^(\d+)\s*\/\s*(\d+)$/)))return+m[1]/+m[2];
  if(/^(half|½)$/i.test(p))return .5;const v=parseFloat(p);return v>0&&v<=1?v:null}
function portionShare(m,id,part){if(part!=="rest")return partShare(part);let used=0;for(const st of allSteps(m))for(const t of tokensOf(st))if(t.id===id&&t.part&&t.part!=="rest")used+=partShare(t.part)||0;return Math.max(0,1-used)}
/* grams in one tablespoon; a meal ingredient can set its own with "tbsp" in the ingredients library */
const TBSP_G=[[/olej/,13.5],[/arasid|burak|kesu|mandl.*masl/,16],[/maslo/,14],[/\bmed\b/,21],[/soj.*omack|omack.*soj/,16],[/ocet|octa/,15],[/kecup/,17],[/horcic/,15],[/mouk/,8],[/cukr/,12.5],[/\bsul\b/,18],
  [/protlak|pyre/,16],[/jogurt|skyr|smetan|kefir|mlek|napoj|vyvar/,15],[/tvaroh/,16],[/vlakn|slupk|kakao/,7],[/vlock/,5],[/sirup/,20]];
function tbspG(id,liquid){const x=ING[id];if(!x)return 15;if(x.tbsp>0)return+x.tbsp;const n=fold(x.name)+" "+id;for(const[re,g] of TBSP_G)if(re.test(n))return g;return x.spice&&!liquid?7:15}
const halfTxt=v=>{const w=Math.floor(v);return v-w>=.25&&v-w<.75?`${w||""}½`:String(Math.round(v))};
function fmtUnitAmt(g,id,unit){const x=ING[id];const base=fmtAmt(g,x.unit);if(!unit||x.unit==="ks")return base;
  if(unit==="cloves"){const c=Math.max(.5,Math.round(g/5*2)/2);return`${halfTxt(c)} ${c<=1?"clove":"cloves"} / ${base}`}
  if(unit==="ml"){const ml=g/(tbspG(id,true)/15);const st=ml<50?5:10;return`${Math.max(st,Math.round(ml/st)*st)} ml / ${base}`}
  const d=tbspG(id);if(unit==="spoon")unit=g/d>=.9?"tbsp":"tsp";
  const v=unit==="tsp"?g/(d/3):g/d;return`${fmtQty(v,unit)} / ${base}`}
function renderStep(txt,m,n,occ){const k=n/(m.stepBatch||4)*(m.stepScale||1);
  return String(txt).replace(TOK,(all,id,part,unit)=>{const rows=(m.items||[]).filter(x=>x[0]===id);if(!rows.length||!ING[id])return all;
      let a=rows.reduce((t,x)=>t+x[1],0);
      if(part){const sh=portionShare(m,id,part.trim());if(sh==null)return all;a*=sh}
      else if(rows.length>1&&occ){const j=occ[id]||0;occ[id]=j+1;if(tokenCount(m,id)===rows.length&&rows[j])a=rows[j][1]}
      return fmtUnitAmt(a*n,id,unit)})
    .replace(/\{q:([^}]+)\}/g,(all,q)=>{const p=parseQty(q);return p?fmtQty(p.v*k,p.u):q})
    .replace(/\s*\{@[a-z0-9-]+\}/g,"").replace(/ {2,}/g," ")}

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

/* ---------- deals found in the letáky ----------
   A deal = {id: ingredient id, store, price (Kč), amt + u (what the price is for: 1 kg, 500 g, 6 ks), was (normal price, optional), until (ISO date), note}.
   Deals never change a plan by themselves: they nudge Suggest, show up on slots and the shopping list, and can be put in the plan with one tap. */
const STORES=["Albert","Billa","Kaufland","Lidl","Tesco","Rohlík","Košík"];
const ONLINE_STORES=["Tesco","Rohlík","Košík"];   // ordered online: a deal there stays on the main list as a price tag
const kc=n=>(+n).toFixed(2).replace(".",",").replace(/,00$/,"");
const fmtDate=iso=>{if(!iso)return"";const d=new Date(iso+"T12:00:00");return`${d.toLocaleDateString("en-GB",{weekday:"short"})} ${d.getDate()}.${d.getMonth()+1}.`};
const dealActive=d=>!!ING[d.id]&&(!d.until||d.until>=todayISO());
const activeDeals=()=>DEALS.filter(dealActive);
function dealUnit(d){const x=ING[d.id];if(!x)return null;const a=d.amt>0?d.amt:1;let base;
  if(x.unit==="ks"){if(d.u!=="ks")return null;base=a}else{if(d.u==="kg")base=a;else if(d.u==="g")base=a/1000;else return null}
  return{price:d.price/base,was:d.was>0?d.was/base:null}}
const dealsFor=id=>activeDeals().filter(d=>d.id===id).sort((a,b)=>(dealUnit(a)?.price??1e9)-(dealUnit(b)?.price??1e9));
function dealCost(d,amt){const u=dealUnit(d);if(!u)return 0;return u.price*(ING[d.id].unit==="ks"?amt:amt/1000)}
const dealPct=d=>d.was>d.price?Math.round(100*(1-d.price/d.was)):0;
function dealPriceText(d){const per=ING[d.id]?.unit==="ks"?"ks":"kg",one=!(d.amt>0)||d.amt===1;
  if(one&&d.u===per)return`${kc(d.price)} Kč/${per}`;
  const u=dealUnit(d);return`${kc(d.price)} Kč / ${kc(d.amt>0?d.amt:1)} ${d.u}`+(u?` (${kc(u.price)} Kč/${per})`:"")}
const dealLabel=d=>`${d.store} ${dealPriceText(d)}`;
const mealDeals=m=>{const on=new Set(activeDeals().map(d=>d.id));return[...new Set((m?.items||[]).map(i=>i[0]).filter(i=>on.has(i)))]};
function dealPickStore(id){const st=DEALPICK[id];return st&&!ONLINE_STORES.includes(st)&&dealsFor(id).some(d=>d.store===st)?st:null}
function dealPlanMeals(id){const out=[];for(const[b,bn] of BLOCKS)for(const[s,sn] of SLOTS){const sl=PLAN[b][s],m=PM(sl.meal);if(m&&(m.items||[]).some(i=>i[0]===id))out.push({meal:sl.meal,name:m.name,where:`${bn} ${sn.toLowerCase()}`})}return out}
function dealMeals(id){return Object.keys(MEALS).filter(mid=>(PM(mid)?.items||[]).some(i=>i[0]===id)).sort((a,b)=>MEALS[a].name.localeCompare(MEALS[b].name,"cs"))}

/* ---------- suggest (randomise) ---------- */
const mealsFor=cat=>Object.entries(MEALS).filter(([,m])=>m.cat===cat).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
const planFresh=skip=>{let n=0;for(const[b] of BLOCKS)for(const[s] of SLOTS){if(skip===b+"|"+s)continue;if(isFresh(MEALS[PLAN[b][s].meal]))n++}return n};
function randomPick(cat,avoid,slotKey,wantFresh){const all=mealsFor(cat).map(e=>e[0]);const list=all.filter(id=>!avoid.includes(id));let pool=list.length?list:all;
  if(wantFresh){const fr=pool.filter(id=>isFresh(MEALS[id]));if(fr.length)return fr[Math.floor(Math.random()*fr.length)]}
  if(!FRESH){const nf=pool.filter(id=>!isFresh(MEALS[id]));if(nf.length)pool=nf}
  // a slot that isn't 6 servings skips freezer-pack recipes, so no pack is left part-used
  if(slotServ(slotKey)!==PACK_SERV&&!FRESH){const np=pool.filter(id=>!isFreezerFit(MEALS[id]));if(np.length)pool=np}
  const weighted=[];for(const id of pool){const n=1+4*Math.min(2,mealUses(MEALS[id],true).length+mealDeals(PM(id)).length);for(let i=0;i<n;i++)weighted.push(id)}
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
  const kaufland=all.filter(x=>isKauflandPick(x.id)&&!dealPickStore(x.id)).sort(byName);
  const lidl=all.filter(x=>isLidlPick(x.id)&&!isKauflandPick(x.id)&&!dealPickStore(x.id)).sort(byName);
  const away=id=>isLidlPick(id)||isKauflandPick(id)||!!dealPickStore(id);
  const groups={};for(const x of all){const st=dealPickStore(x.id);if(st)(groups[st]=groups[st]||[]).push(x)}
  const dealGroups=Object.keys(groups).sort((a,b)=>a.localeCompare(b,"cs")).map(store=>({store,items:groups[store].sort(byName)}));
  return{reg:toList(reg,"r:",orig.reg).filter(x=>!away(x.id)),b2:toList(b2,"b:",orig.b2).filter(x=>!away(x.id)),lidl,kaufland,dealGroups,
    spices:Object.entries(spice).map(([id,a])=>({id,name:ING[id].name,amt:a})).sort(byName),removed:removed.sort(byName)}}

// Plain-text list for the Tesco skill or for pasting into a chat. One line per item: name, amount, unit.
function listText(){const{reg,b2,lidl,kaufland,dealGroups}=shoppingData();const line=x=>`${x.name}${x.b2?" (Block 2, buy fresh)":""}\t${fmtPlain(x.amt,x.unit)}\t${x.unit==="ks"?"ks":"g"}`;let t="";
  const sec=(title,a)=>{if(a.length)t+=(t?"\n":"")+title+"\n"+a.map(line).join("\n")+"\n"};
  sec("ONLINE (Rohlík / Košík / Tesco)",reg);sec("ONLINE, BLOCK 2 BAKERY (buy fresh)",b2);sec("LIDL",lidl);sec("KAUFLAND",kaufland);for(const g of dealGroups)sec(g.store.toUpperCase()+" (THIS WEEK'S DEAL)",g.items);return t.trim()}
function planText(){let t="";for(const[s,label] of SLOTS){const f=b=>{const m=MEALS[PLAN[b][s].meal];return`${label}: ${m?m.name:"None"} (${PLAN[b][s].n})`};t+=`${f("block1")}\t\t${f("block2")}\n`}return t.trim()}

/* ---------- loading from the server's documents ---------- */
function loadDocs(docs){ING=docs["lib/ingredients"]?.data?.items||{};MEALS={};
  for(const[p,d] of Object.entries(docs))if(p.startsWith("meals/"))MEALS[p.slice(6)]=d.data;
  TARGETS=docs["settings/targets"]?.data||null;SAFETY=docs["settings/safety"]?.data||null;SHOPSET=docs["settings/shopping"]?.data||null;
  const d=docs["state/plan"]?.data;const cl=o=>JSON.parse(JSON.stringify(o||{}));
  const dd=docs["state/deals"]?.data;DEALS=Array.isArray(dd?.deals)?cl(dd.deals):[];DEALPICK=cl(dd?.pick);
  if(d){PLAN=mergePlan(d.plan);SWAPS=cl(d.swaps);DISMISSED=cl(d.dismissed);EDITS=cl(d.edits);CHECKED=cl(d.checked);MINCE=d.mince==="lean"?"lean":"8020";FRESH=!!d.freshChicken;USEUP=Array.isArray(d.useup)?cl(d.useup):[];LISTWEEK=d.listWeek||null}
  else{PLAN=emptyPlan();SWAPS={};DISMISSED={};EDITS={};CHECKED={};MINCE="8020";FRESH=false;USEUP=[];LISTWEEK=null}
  reconcile()}
const planDoc=()=>({plan:PLAN,swaps:SWAPS,dismissed:DISMISSED,edits:EDITS,checked:CHECKED,mince:MINCE,freshChicken:FRESH,useup:USEUP,listWeek:LISTWEEK||weekKey()});

/* ---------- Cook views (shared with the read-only Cook page) ---------- */
const who=s=>s.startsWith("snack")?"Kyle":"Kyle & Annie";
const slotCat=s=>(SLOTS.find(x=>x[0]===s)||[])[2]||"snack";
function slotRows(b){return SLOTS.map(([s,label])=>({s,label,cat:slotCat(s),sel:PLAN[b][s],m:PM(PLAN[b][s].meal)})).filter(x=>x.m)}
const mtype=x=>`<span class="mtype" data-cat="${x.cat}">${esc(x.label)}</span>`;
const legendHTML=()=>`<div class="legend" aria-label="Meal colours">${CATS.map(([c,l])=>`<span class="mtype" data-cat="${c}">${l}</span>`).join("")}<span class="muted small">Tap a step when it's done. Its ingredients get crossed off.</span></div>`;

/* ---------- ticking off steps ----------
   Which ingredients a step uses: its {=id} / {@id} tokens, then English words matched to the Czech ingredient names below.
   An ingredient is crossed off only when every step that uses it is ticked; until then it shows as part-used.
   Ingredients no step mentions are crossed off once all the steps on the card are done.
   Ticks live on this device only (no password page writes to the server): prep-day ticks for the week, each-day ticks for today. */
const EN_RULES=[ // [test on the folded Czech name + id, English words used in steps, unless this test matches]
 [/kure/,["chicken"]],[/kure.*prs|prsa/,["chicken breast","chicken breasts","breast","breasts"]],[/stehn/,["thigh","thighs","chicken thighs"]],
 [/hovez/,["beef"]],[/mlet.*(maso|hovez|vepr|kure)|(hovez|vepr|kure).*mlet/,["mince","minced","ground beef","ground meat"]],[/vepr/,["pork"]],[/krut|krocan/,["turkey"]],
 [/slanin/,["bacon"]],[/sunk/,["ham"]],[/losos/,["salmon"]],[/tunak/,["tuna"]],[/tresk/,["cod"]],[/\bryb/,["fish"]],
 [/ryz/,["rice"],/chlebic/],[/bulgur/,["bulgur","bulghur"]],[/kuskus/,["couscous"]],[/quinoa|kinoa/,["quinoa"]],
 [/testovin|spaget|penne|fusill|nudl|tagliat/,["pasta","spaghetti","penne","fusilli","noodles","tagliatelle"]],
 [/brambor/,["potato","potatoes"],/sladk|batat/],[/batat|sladk.*brambor/,["sweet potato","sweet potatoes"]],[/ovesn|vlock/,["oats","oat","porridge","oatmeal"]],
 [/chleb|toast/,["bread","toast"],/chlebic/],[/chlebic|krehk|knacke/,["crispbread","crispbreads","crackers","rice cakes","rice cake"]],[/tortil|wrap/,["tortilla","tortillas","wrap","wraps"]],
 [/brokol/,["broccoli"]],[/cibul/,["onion","onions"],/cibulk/],[/cibulk/,["spring onion","spring onions","scallion","scallions","green onion","green onions"]],[/cesn/,["garlic"]],
 [/mrkev|mrkv/,["carrot","carrots"]],[/cuket/,["courgette","courgettes","zucchini"]],[/rajc|rajsk/,["tomato","tomatoes"]],
 [/protlak|pyre/,["tomato paste","tomato puree","puree"]],[/spenat/,["spinach"]],[/houb|zampion/,["mushroom","mushrooms"]],[/hrasek|hrach/,["peas"]],
 [/kukur/,["corn","sweetcorn"]],[/fazol/,["beans"],/fazolk/],[/fazolk/,["green beans"]],[/cizrn/,["chickpeas","chickpea"]],[/cock/,["lentils"]],
 [/okurk/,["cucumber","cucumbers"]],[/salat/,["lettuce","salad leaves"],/okurk/],[/\bzeli\b/,["cabbage"]],[/kvetak/,["cauliflower"]],[/zelenin/,["vegetables","veg","veggies"]],
 [/vejc|vajic/,["egg","eggs"],/bilk/],[/bilk/,["egg white","egg whites"]],
 [/\bsyr|eidam|edam|gouda|cedar|mozzarel|parmaz|parmez|grana|feta|balkan|cottage|niva|hermelin/,["cheese"]],[/eidam|edam/,["eidam","edam"]],[/mozzarel/,["mozzarella"]],
 [/parmaz|parmez|grana/,["parmesan"]],[/feta|balkan/,["feta"]],[/cottage/,["cottage cheese","cottage"]],[/tvaroh/,["tvaroh","quark","curd"]],
 [/jogurt/,["yogurt","yoghurt"]],[/skyr/,["skyr"]],[/kefir/,["kefir"]],[/mlek|napoj/,["milk"]],[/soj.*(mlek|napoj)|(mlek|napoj).*soj/,["soy milk","soya milk"]],
 [/smetan/,["cream"],/zakys/],[/zakys/,["sour cream"]],[/maslo/,["butter"],/arasid|burak|kesu|mandl/],[/arasid|burak/,["peanut butter","peanut"]],
 [/olej/,["oil"]],[/olivov/,["olive oil"]],[/\bsul\b/,["salt"]],[/pepr/,["black pepper","salt and pepper","pepper"]],[/kmin/,["cumin","caraway"]],[/oregan/,["oregano"]],
 [/bazalk/,["basil"]],[/petrzel/,["parsley"]],[/koriandr/,["coriander","cilantro"]],[/skoric/,["cinnamon"]],[/chil/,["chilli","chili","chilli flakes"]],
 [/\bkari\b|curry/,["curry","curry powder"]],[/zazvor/,["ginger"]],[/kurkum/,["turmeric"]],[/majoran/,["marjoram"]],[/tymian/,["thyme"]],[/citron/,["lemon"]],[/limet/,["lime"]],
 [/\bmed\b/,["honey"]],[/sojov.*omack|omack.*soj/,["soy sauce"]],[/ocet|octa/,["vinegar"]],[/horcic/,["mustard"]],[/kecup/,["ketchup"]],
 [/vyvar|bujon/,["stock","broth","bouillon","stock cube"]],[/mouk/,["flour"]],[/(^|\s)cukr(\s|$)/,["sugar"]],[/kesu/,["cashew","cashews"]],[/orech|orisk/,["nuts","walnuts","hazelnuts"]],
 [/mandl/,["almond","almonds"]],[/banan/,["banana","bananas"]],[/jahod/,["strawberry","strawberries"]],[/boruv/,["blueberry","blueberries"]],[/malin/,["raspberry","raspberries"]],
 [/jablk|jablec/,["apple","apples"]],[/ovoc/,["fruit","berries"]],[/protein|syrovatk/,["protein powder","protein","whey"]],[/hummus/,["hummus"]],[/vlakn|slupk/,["powder","fibre","fiber"]],[/kakao/,["cocoa"]]];
// Czech "paprika" is a bell pepper; English "paprika" is the ground spice. Never let one stand in for the other.
const PAPRIKA_SPICE=["paprika","smoked paprika","sweet paprika","hot paprika"],BELL=["pepper","peppers","bell pepper","bell peppers","red pepper","red peppers","capsicum"];
const NAME_STOP=new Set(["paprika","mleta","mlete","maso","light","polotucny","tucny","nizkotucny","jasminova","jasminova","zitny","vyberove","libove","cerstve","mrazene","mrazena","plnotucne","sterilovane","konzerva"]);
const _kw={};
function ingWords(id){const x=ING[id];if(!x)return[];const ck=id+"|"+x.name;if(_kw[ck])return _kw[ck];
  const n=fold(x.name)+" "+id.replace(/-/g," ");const out=new Set();
  if(/paprik/.test(n))(x.spice||/mlet|uzen|sladk|pal|koreni/.test(n)?PAPRIKA_SPICE:BELL).forEach(w=>out.add(w));
  for(const[re,ws,not] of EN_RULES)if(re.test(n)&&!(not&&not.test(n)))ws.forEach(w=>out.add(w));
  for(const w of fold(x.name).split(/[^a-z0-9]+/))if(w.length>=4&&!NAME_STOP.has(w))out.add(w);
  return _kw[ck]=[...out]}
const reEsc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
function stepLinks(m,steps){const ids=[...new Set((m.items||[]).map(x=>x[0]))].filter(id=>ING[id]);
  const byWord=new Map();for(const id of ids)for(const w of ingWords(id)){const f=fold(w);if(!byWord.has(f))byWord.set(f,new Set());byWord.get(f).add(id)}
  const words=[...byWord.keys()].sort((a,b)=>b.length-a.length); // longest first, so "black pepper" is taken before "pepper"
  return steps.map(st=>{const found=new Set(),part=new Set();
    let t=String(st).replace(/\{([=@])([a-z0-9-]+)(:[^}|]+)?(\|[a-z]+)?\}/g,(a,k,id,pt)=>{if(ids.includes(id)){found.add(id);if(pt)part.add(id)}return" "}).replace(/\{q:[^}]*\}/g," ");t=" "+fold(t)+" ";
    for(const w of words){const re=new RegExp("([^a-z0-9])"+reEsc(w)+"(?=[^a-z0-9])","g");
      if(re.test(t)){re.lastIndex=0;for(const mm of t.matchAll(re)){const before=t.slice(Math.max(0,mm.index-40),mm.index+1);if(SPLIT_RE.test(before))byWord.get(w).forEach(id=>part.add(id))}
        byWord.get(w).forEach(id=>found.add(id));t=t.replace(re,(a,p)=>p+"#".repeat(w.length))}}
    found.part=part;return found})}
/* words just before an ingredient that mean only part of it goes in here, so it isn't finished until the rest is used */
const SPLIT_RE=/\b(half|halves|most|some|part|rest|remaining|remainder|another|other|reserve|reserved|leftover|third|quarter|a little|a bit|little more|more of|extra)\b[^.;]*$/;
const hashStr=s=>{let h=5381;for(const c of String(s))h=(h*33+c.charCodeAt(0))|0;return(h>>>0).toString(36)};

const TICK_KEY="mealprep-ticks";let TICKS=new Map();
function tickLoad(){try{const o=JSON.parse(localStorage.getItem(TICK_KEY)||"{}");const cut=Date.now()-12*864e5;TICKS=new Map(Object.entries(o).filter(([,v])=>v&&v.t>cut))}catch(e){}}
function tickSave(){try{localStorage.setItem(TICK_KEY,JSON.stringify(Object.fromEntries(TICKS)))}catch(e){}}
tickLoad();
const phaseScope=ph=>ph==="prep"?"w"+weekKey():"d"+todayISO();
/* phases: [[phase, steps]] shown on this card; info: phases not shown, used only to say "used on the day" */
/* An ingredient is used at the first step that names it; later mentions are the same food being handled again.
   Only when a step takes a portion ({=id:…} or words like "half", "the rest", "remaining" before it) is the ingredient split:
   then it stays part-used until every portion step is ticked. Phases not shown on this card (info) only add "rest on the day". */
function tickCtx(b,s,mid,m,phases,info){const c={keys:{},label:{},uses:{},all:[],later:new Set(),laterPart:new Set()};const both=phases.filter(p=>p[1].length).length>1;
  const first={},parts={};
  for(const[ph,steps] of phases){const links=stepLinks(m,steps);steps.forEach((st,i)=>{const k=`${phaseScope(ph)}|${b}|${s}|${mid}|${ph}|${i}|${hashStr(st)}`;
    c.keys[ph+i]=k;c.label[k]=(both?(ph==="prep"?"prep ":"day "):"step ")+(i+1);c.all.push(k);
    for(const id of links[i]){if(!first[id])first[id]=k;if(links[i].part.has(id))(parts[id]=parts[id]||[]).push(k)}})}
  for(const id in first){const u=[first[id],...(parts[id]||[]).filter(k=>k!==first[id])];c.uses[id]=c.all.filter(k=>u.includes(k))}
  for(const[,steps] of info||[])for(const set of stepLinks(m,steps))for(const id of set){if(!c.uses[id])c.later.add(id);else if(set.part.has(id))c.laterPart.add(id)}
  return c}
/* attributes for one ingredient row; a meal can list the same ingredient twice (row j of k): split its steps between the rows in order */
function ingTick(c,dk,id,j,k){let u=c.uses[id]||[];if(k>1&&u.length>=k)u=j<k-1?[u[j]]:u.slice(k-1);
  return` data-ik="${esc(dk)}|i|${esc(id)}|${j}" data-uses="${esc(u.join(" "))}" data-lbl="${esc(u.map(x=>c.label[x]).join("|"))}"${!u.length&&c.later.has(id)?" data-later=\"1\"":""}${u.length&&c.laterPart.has(id)?" data-laterpart=\"1\"":""} tabindex="0" title="Tap to cross off or bring back"`}
function ingRowsInfo(m){const cnt={},seen={};for(const[id] of m.items||[])cnt[id]=(cnt[id]||0)+1;return(m.items||[]).filter(([id])=>ING[id]).map(([id,a])=>{const j=seen[id]=(seen[id]??-1)+1;return{id,a,j,k:cnt[id]}})}
const usesSpan=`<small class="uses" data-ul></small>`;
function tickSteps(c,ph,steps,m,n){const occ=occFor(m,ph);return`<ol class="steps tick">${steps.map((st,i)=>{const k=c.keys[ph+i];
  return`<li><label><input type="checkbox" data-ck="${esc(k)}"${TICKS.has(k)?" checked":""}><span>${esc(renderStep(st,m,n,occ))}</span></label></li>`}).join("")}</ol>`}
const resetBtn=`<button class="linkbtn tickreset" data-tickreset hidden>Clear ticks</button>`;
function applyTicks(root){(root||document).querySelectorAll(".dish[data-dk]").forEach(d=>{
  const on=new Set([...d.querySelectorAll("[data-ck]")].filter(x=>x.checked).map(x=>x.dataset.ck));const fb=(d.dataset.fallback||"").split(" ").filter(Boolean);let any=on.size>0;
  d.querySelectorAll("[data-ik]").forEach(el=>{const own=(el.dataset.uses||"").split(" ").filter(Boolean);const uses=own.length?own:el.dataset.later?[]:fb;
    const lp=!!el.dataset.laterpart,all=uses.length>0&&uses.every(k=>on.has(k)),auto=all&&!lp,some=uses.some(k=>on.has(k));const ov=TICKS.get(el.dataset.ik);if(ov)any=true;const done=ov?ov.v==="1":auto;
    el.classList.toggle("done",done);el.classList.toggle("partial",!done&&some&&(own.length>1||lp));el.setAttribute("aria-pressed",done);
    const ul=el.querySelector("[data-ul]");if(ul){const lb=(el.dataset.lbl||"").split("|");
      ul.textContent=own.length>1?(some&&!done?"Part used: ":"Split over ")+own.map((k,i)=>lb[i]+(on.has(k)?" ✓":"")).join(", "):lp?(all&&!done?"Part used, the rest goes in on the day":"Part now, the rest on the day"):el.dataset.later?"used on the day":"";ul.classList.toggle("two",own.length>1||lp)}});
  const r=d.querySelector("[data-tickreset]");if(r)r.hidden=!any})}
function tickStep(cb){const d=cb.closest(".dish");const k=cb.dataset.ck;if(cb.checked)TICKS.set(k,{t:Date.now()});else TICKS.delete(k);
  if(d){const fb=(d.dataset.fallback||"").split(" ");d.querySelectorAll("[data-ik]").forEach(el=>{const u=(el.dataset.uses||"").split(" ").filter(Boolean);if((u.length?u:fb).includes(k))TICKS.delete(el.dataset.ik)})}
  tickSave();applyTicks(d?.parentNode||document)}
function tickIng(el){el.classList.contains("done")?TICKS.set(el.dataset.ik,{t:Date.now(),v:"0"}):TICKS.set(el.dataset.ik,{t:Date.now(),v:"1"});tickSave();applyTicks(el.closest(".dish").parentNode)}
document.addEventListener("change",e=>{const cb=e.target.closest?.("[data-ck]");if(cb)tickStep(cb)});
document.addEventListener("click",e=>{const r=e.target.closest?.("[data-tickreset]");if(r){const d=r.closest(".dish");d.querySelectorAll("[data-ck]").forEach(x=>{x.checked=false;TICKS.delete(x.dataset.ck)});d.querySelectorAll("[data-ik]").forEach(x=>TICKS.delete(x.dataset.ik));tickSave();applyTicks(d.parentNode);return}
  const el=e.target.closest?.("[data-ik]");if(el&&!e.target.closest("a,button,input"))tickIng(el)});
document.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const el=e.target.closest?.("[data-ik]");if(el&&e.target===el){e.preventDefault();tickIng(el)}});
window.addEventListener("storage",e=>{if(e.key!==TICK_KEY)return;tickLoad();document.querySelectorAll("[data-ck]").forEach(x=>x.checked=TICKS.has(x.dataset.ck));applyTicks(document)});

function prepHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;const ahead=ms.filter(x=>x.m.prep!=="fresh"),fresh=ms.filter(x=>x.m.prep==="fresh");
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name} prep</h2><span class="tape">${days}</span></div>
    ${ahead.length?ahead.map(x=>{const m=x.m,mid=x.sel.meal,dk=`w${weekKey()}|${b}|${x.s}|${mid}|prep`;
      const c=tickCtx(b,x.s,mid,m,[["prep",m.prepSteps||[]]],[["day",m.daySteps||[]]]);
      return`<div class="dish" data-cat="${x.cat}" data-dk="${esc(dk)}" data-fallback="${m.prep==="hybrid"?"":esc(c.all.join(" "))}"><div class="row">${mtype(x)}<h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span>${resetBtn}</div>
      <p class="muted small">${x.sel.n} servings${esc(spareText(b,x.s))}${m.keeps?` · keeps ${esc(m.keeps)}`:""} · ${who(x.s)}</p>
      <ul class="ings">${ingRowsInfo(m).map(({id,a,j,k})=>`<li${ingTick(c,dk,id,j,k)}><span>${esc(ING[id].name)}${esc((isFresh(m)||x.sel.fresh)&&id==="kureci-prsa"?" (buy fresh)":packNote(id,a*x.sel.n))}${usesSpan}</span><b>${fmtAmt(a*x.sel.n,ING[id].unit)}</b></li>`).join("")}</ul>
      ${tickSteps(c,"prep",m.prepSteps||[],m,x.sel.n)}${m.note?`<p class="note">${esc(m.note)}</p>`:""}</div>`}).join(""):`<p class="muted">Nothing to cook ahead for this block.</p>`}
    ${fresh.length?`<p class="muted" style="margin-top:14px">Made on the day: ${fresh.map(x=>esc(x.m.name+spareText(b,x.s))).join(", ")}.</p>`:""}</section>`}
  return html?legendHTML()+html:`<div class="empty">Choose meals on the Plan tab to see what to cook on prep day.</div>`}
function eachDayHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name}</h2><span class="tape">${days}</span></div>
    ${ms.map(x=>{const m=x.m,mid=x.sel.meal,steps=m.daySteps||[],dk=`d${todayISO()}|${b}|${x.s}|${mid}|day`;const c=tickCtx(b,x.s,mid,m,[["day",steps]]);
      return`<div class="dish" data-cat="${x.cat}" data-dk="${esc(dk)}" data-fallback="${esc(c.all.join(" "))}"><div class="row">${mtype(x)}<h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span>${resetBtn}</div>
      <p class="muted small">${who(x.s)} · ${x.sel.n} servings${esc(spareText(b,x.s))}</p>
      ${m.prep==="fresh"?`<ul class="ings">${ingRowsInfo(m).map(({id,a,j,k})=>`<li${ingTick(c,dk,id,j,k)}><span>${esc(ING[id].name)}${usesSpan}</span><b>${fmtAmt(a,ING[id].unit)}</b></li>`).join("")}</ul>`:`<p class="muted small">Cooked on prep day.</p>`}
      ${steps.length?`<h4>${m.prep==="fresh"?"Method":"Before serving"}</h4>${tickSteps(c,"day",steps,m,1)}`:""}
      ${m.prep==="fresh"&&m.note?`<p class="note">${esc(m.note)}</p>`:""}</div>`}).join("")}</section>`}
  return html?legendHTML()+html:`<div class="empty">Choose meals on the Plan tab and each day's steps appear here.</div>`}
function weekRecipesHTML(){let html="";
  for(const[b,name,days] of BLOCKS){const ms=slotRows(b);if(!ms.length)continue;
    html+=`<section class="panel" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>${name}</h2><span class="tape">${days}</span></div>
    ${ms.map(x=>{const m=x.m,per=x.sel.n,t=macros(m),mid=x.sel.meal,dk=`w${weekKey()}|${b}|${x.s}|${mid}|week`;
      const c=tickCtx(b,x.s,mid,m,[["prep",m.prepSteps||[]],["day",m.daySteps||[]]]);
      return`<article class="dish" data-cat="${x.cat}" data-dk="${esc(dk)}" data-fallback="${esc(c.all.join(" "))}"><div class="row">${mtype(x)}<h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span>${resetBtn}</div>
      <p class="muted small">${per} servings${m.keeps?` · keeps ${esc(m.keeps)}`:""} · per serving ${Math.round(t.kcal)} kcal, P ${Math.round(t.p)} · C ${Math.round(t.c)} · F ${Math.round(t.f)}</p>
      <div class="scroll"><table class="ingtick"><thead><tr><th>Ingredient</th><th class="num">1 serving</th><th class="num">${per} servings</th></tr></thead><tbody>${ingRowsInfo(m).map(({id,a,j,k})=>`<tr${ingTick(c,dk,id,j,k)}><td>${esc(ING[id].name)}${usesSpan}</td><td class="num">${fmtAmt(a,ING[id].unit)}</td><td class="num">${fmtAmt(a*per,ING[id].unit)}</td></tr>`).join("")}</tbody></table></div>
      ${(m.prepSteps||[]).length?`<h4>On prep day</h4>${tickSteps(c,"prep",m.prepSteps,m,per)}`:""}
      ${(m.daySteps||[]).length?`<h4>${m.prep==="fresh"?"Method":"On the day"}</h4>${tickSteps(c,"day",m.daySteps,m,per)}`:""}
      ${m.note?`<p class="note">${esc(m.note)}</p>`:""}</article>`}).join("")}</section>`}
  return html?legendHTML()+html:`<div class="empty">Choose meals on the Plan tab and their recipes appear here.</div>`}

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
