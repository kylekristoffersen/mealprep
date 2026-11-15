/* Library screens: Recipes (with Import), Ingredients, Targets. */
"use strict";

/* ---------- saving ---------- */
async function saveMeal(id,m){MEALS[id]=m;const ok=await putDoc("meals/"+id,m);if(ok)toast("Meal saved");return ok}
async function removeMeal(id){delete MEALS[id];for(const[b] of BLOCKS)for(const[s] of SLOTS)if(PLAN[b][s].meal===id)PLAN[b][s].meal="";savePlan();const ok=await delDoc("meals/"+id);if(ok)toast("Meal deleted")}
let ingTimer=null;
function saveIngs(){clearTimeout(ingTimer);ingTimer=setTimeout(async()=>{ingTimer=null;await putDoc("lib/ingredients",{items:ING})},500)}
async function saveTargets(t){TARGETS=t;if(await putDoc("settings/targets",t))toast("Targets saved")}

/* ---------- RECIPES ---------- */
function recipesView(v){
  if(ui.imp){v.innerHTML=importHTML();bindImport();return}
  if(ui.edit){v.innerHTML=editorHTML();bindEditor();return}
  if(ui.open&&MEALS[ui.open]){v.innerHTML=detailHTML(ui.open);return}
  const list=Object.entries(MEALS).filter(([,m])=>(ui.cat==="all"||m.cat===ui.cat)&&(!ui.q||fold(m.name).includes(fold(ui.q)))).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
  v.innerHTML=`<div class="row" style="justify-content:space-between;margin-bottom:12px"><input id="rq" type="search" placeholder="Search meals" value="${esc(ui.q)}" style="flex:1 1 220px"><button class="btn" data-act="openImport">Import recipes</button><button class="btn primary" data-new="1">New meal</button></div>
  <div class="filters">${[["all","All"],...CATS].map(([k,l])=>`<button data-cat="${k}" aria-pressed="${ui.cat===k}">${l}</button>`).join("")}</div>
  <div class="cards">${list.map(([id,m])=>`<button class="card" data-open="${esc(id)}"><div class="row" style="justify-content:space-between"><h3>${esc(m.name)}</h3><span class="prep ${m.prep}">${m.prep}</span></div><div class="row">${chipFor(m)}</div></button>`).join("")||`<p class="muted">No meals match.</p>`}</div>`;
  const q=$("#rq");if(q)q.oninput=()=>{ui.q=q.value;const pos=q.selectionStart;recipesView($("#view"));const n=$("#rq");n.focus();n.setSelectionRange(pos,pos)}}
/* shows which ingredients the Cook page will cross off for each step, so a wrong match can be fixed with {@ingredient-id} */
function linkNote(m,steps,i){const l=(linkNote.c?.m===m&&linkNote.c.steps===steps?linkNote.c:(linkNote.c={m,steps,links:stepLinks(m,steps)})).links[i];
  return`<br><small class="uses">${l.size?"crosses off: "+[...l].map(id=>esc(ING[id].name)).join(", "):"crosses off: nothing named (done when the last step is ticked)"}</small>`}
function detailHTML(id){const m=MEALS[id];const n=ui.servings;const t=macros(m);const tg=mealTarget(m.cat);
  const rows=(m.items||[]).map(([iid,a])=>{const x=ING[iid];return x?`<tr><td>${esc(x.name)}${x.est?` <span class="est" title="Estimated nutrition value">est</span>`:""}</td><td class="num">${fmtAmt(a,x.unit)}</td><td class="num">${fmtAmt(a*n,x.unit)}</td></tr>`:""}).join("");
  const tr=k=>tg?`<td class="num"><span class="chip ${rangeStatus(t[k],tg[k][0],tg[k][1])}">${Math.round(t[k])}</span></td><td class="num muted">${tg[k][0]}–${tg[k][1]}</td>`:`<td class="num">${Math.round(t[k])}</td><td></td>`;
  return`<div class="row" style="margin-bottom:12px"><button class="btn" data-back="1">← All meals</button><button class="btn" data-editmeal="${esc(id)}">Edit</button></div>
  <section class="panel"><div class="row"><h2>${esc(m.name)}</h2><span class="prep ${m.prep}">${m.prep}</span><span class="tape">${CATS.find(c=>c[0]===m.cat)?.[1]||esc(m.cat)}</span></div>
  ${m.keeps?`<p class="muted" style="margin:6px 0 0">Keeps ${esc(m.keeps)} in the fridge.</p>`:""}${m.note?`<p class="note">${esc(m.note)}</p>`:""}
  <div class="grid2" style="margin-top:14px"><div class="scroll"><table><thead><tr><th>Ingredient</th><th class="num">1 serving</th><th class="num"><span class="step" style="justify-content:flex-end"><button data-sv="-1" aria-label="Fewer">−</button><span style="padding-inline:6px">${n} servings</span><button data-sv="1" aria-label="More">+</button></span></th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="scroll"><table><thead><tr><th>Per serving</th><th class="num">Actual</th><th class="num">Target</th></tr></thead><tbody>
  <tr><td>Energy (kcal)</td>${tr("kcal")}</tr><tr><td>Protein (g)</td>${tr("p")}</tr><tr><td>Carbs (g)</td>${tr("c")}</tr><tr><td>Fat (g)</td>${tr("f")}</tr><tr><td>Fibre (g)</td><td class="num">${Math.round(t.fib)}</td><td></td></tr></tbody></table></div></div>
  ${(m.prepSteps||[]).length?`<h3 style="margin-top:18px">On prep day</h3><ol class="steps">${m.prepSteps.map((s,i,a)=>`<li>${esc(renderStep(s,m,n))}${linkNote(m,a,i)}</li>`).join("")}</ol>`:""}
  ${(m.daySteps||[]).length?`<h3 style="margin-top:14px">${m.prep==="fresh"?"Method":"On the day"}</h3><ol class="steps">${m.daySteps.map((s,i,a)=>`<li>${esc(renderStep(s,m,n))}${linkNote(m,a,i)}</li>`).join("")}</ol>`:""}</section>`}
const ingOptions=sel=>Object.entries(ING).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs")).map(([id,x])=>`<option value="${esc(id)}" ${id===sel?"selected":""}>${esc(x.name)}</option>`).join("");
function editorHTML(){const{m,id}=ui.edit;
  return`<div class="row" style="margin-bottom:12px"><button class="btn" data-back="1">← Cancel</button></div>
  <section class="panel" id="editor"><h2>${id?"Edit meal":"New meal"}</h2>
  <div class="form-grid" style="margin-top:12px"><label>Name<input id="e-name" value="${esc(m.name)}"></label>
  <label>Category<select id="e-cat">${CATS.map(([k,l])=>`<option value="${k}" ${m.cat===k?"selected":""}>${l}</option>`).join("")}</select></label>
  <label>Prep style<select id="e-prep">${["batch","hybrid","fresh"].map(k=>`<option ${m.prep===k?"selected":""}>${k}</option>`).join("")}</select></label>
  <label>Keeps<input id="e-keeps" value="${esc(m.keeps||"")}" placeholder="3 days"></label></div>
  <h3 style="margin-top:16px">Ingredients per serving</h3><div class="edit-items" id="e-items">${(m.items||[]).map(([iid,a],i)=>`<div class="row"><select data-ei="${i}">${ingOptions(iid)}</select><input inputmode="decimal" value="${cz(a)}" data-ea="${i}" aria-label="Amount"><span class="muted">${ING[iid]?.unit==="ks"?"ks":"g"}</span><button class="icon" data-erm="${i}" aria-label="Remove ingredient">×</button></div>`).join("")}</div>
  <button class="btn" id="e-add">Add ingredient</button>
  <p style="margin-top:10px">${chipFor({...m})}</p>
  <div class="form-grid" style="margin-top:12px"><label>Prep-day steps (one per line)<textarea id="e-ps">${esc((m.prepSteps||[]).join("\n"))}</textarea></label>
  <label>On-the-day steps (one per line)<textarea id="e-ds">${esc((m.daySteps||[]).join("\n"))}</textarea></label></div>
  <p class="muted small" style="margin:6px 0 0">In steps, <code>{=ingredient-id}</code> shows that ingredient's total for the servings being cooked, and <code>{q:1 tsp}</code> is an amount written for ${m.stepBatch||4} servings that scales with them. <code>{@ingredient-id}</code> prints nothing but tells the Cook page the step uses that ingredient (use it when the step words don't name it clearly).</p>
  <label style="display:grid;gap:4px;margin-top:10px;font-size:.82rem;color:var(--muted)">Note<input id="e-note" value="${esc(m.note||"")}"></label>
  <div class="actions"><button class="btn primary" id="e-save">Save meal</button>${id?`<button class="btn danger" id="e-del">Delete meal</button>`:""}</div><div id="e-confirm"></div></section>`}
function readEditor(){const m=ui.edit.m;m.name=$("#e-name").value.trim();m.cat=$("#e-cat").value;m.prep=$("#e-prep").value;m.keeps=$("#e-keeps").value.trim();m.note=$("#e-note").value.trim();
  m.prepSteps=$("#e-ps").value.split("\n").map(s=>s.trim()).filter(Boolean);m.daySteps=$("#e-ds").value.split("\n").map(s=>s.trim()).filter(Boolean);
  m.items=[...document.querySelectorAll("#e-items .row")].map(r=>[r.querySelector("select").value,czNum(r.querySelector("input").value)||0]);return m}
function bindEditor(){
  $("#e-add").onclick=()=>{readEditor();const first=Object.keys(ING).sort((a,b)=>ING[a].name.localeCompare(ING[b].name,"cs"))[0];if(first)ui.edit.m.items.push([first,100]);render()};
  $("#e-items").addEventListener("change",()=>{readEditor();render()});
  $("#e-items").addEventListener("click",e=>{const b=e.target.closest("[data-erm]");if(!b)return;readEditor();ui.edit.m.items.splice(+b.dataset.erm,1);render()});
  $("#e-save").onclick=async()=>{const m=readEditor();if(!m.name){toast("Give the meal a name first.");return}
    const id=ui.edit.id||(slug(m.name)+"-"+Math.random().toString(36).slice(2,6));if(await saveMeal(id,m)){ui.edit=null;ui.open=id;render()}};
  const del=$("#e-del");if(del)del.onclick=()=>{$("#e-confirm").innerHTML=`<div class="confirm"><span>Delete “${esc(ui.edit.m.name)}” for good?</span><button class="btn danger" id="e-yes">Delete</button><button class="btn" id="e-no">Keep it</button></div>`;
    $("#e-yes").onclick=async()=>{const id=ui.edit.id;await removeMeal(id);ui.edit=null;ui.open=null;render()};$("#e-no").onclick=()=>$("#e-confirm").innerHTML=""}}

/* ---------- IMPORT RECIPES (paste JSON from Claude) ----------
   { "meals": [ { name, cat, prep, keeps, note, stepBatch, stepScale, prepSteps[], daySteps[],
       items: [ {ing:"existing-id", g:150} | {name:"Existing or new name", g:80, unit?, kcal?, p?, c?, f?, fib?, est?} | ["existing-id",150] ] } ] } */
const EXAMPLE=`{"meals":[{"name":"Example bowl","cat":"lunch","prep":"batch","keeps":"3 days","stepBatch":4,
 "items":[{"ing":"kureci-prsa","g":150},{"name":"Rýže jasmínová","g":60}],
 "prepSteps":["Cook the rice.","Add the chicken ({=kureci-prsa}) and a pinch of salt ({q:1 tsp})."],"daySteps":["Reheat until steaming hot."]}]}`;
function parseImport(text){const out={meals:[],newIngs:{},errors:[]};let j;
  try{j=JSON.parse(text)}catch(e){out.errors.push("This isn't valid JSON ("+e.message+"). Paste exactly what Claude gave you.");return out}
  const arr=Array.isArray(j)?j:Array.isArray(j.meals)?j.meals:j.name?[j]:null;if(!arr||!arr.length){out.errors.push("No meals found. Expected {\"meals\":[…]}.");return out}
  const byFold={};for(const[id,x] of Object.entries(ING))byFold[fold(x.name)]=id;
  const used=new Set();
  arr.forEach((raw,i)=>{const r={errors:[],warnings:[],newIngs:[]};const name=String(raw.name||"").trim();if(!name)r.errors.push("No name");
    const cat=CATS.some(c=>c[0]===raw.cat)?raw.cat:null;if(!cat)r.errors.push("cat must be breakfast, lunch, dinner or snack");
    const prep=["batch","hybrid","fresh"].includes(raw.prep)?raw.prep:"batch";if(raw.prep&&prep!==raw.prep)r.warnings.push(`prep “${raw.prep}” isn't batch/hybrid/fresh: using batch`);
    const items=[];
    for(const it of raw.items||[]){let id,amt;
      if(Array.isArray(it)){id=it[0];amt=+it[1]}else{amt=+(it.g??it.amt??it.amount);
        if(it.ing){id=it.ing}else if(it.name){const f=fold(it.name);id=byFold[f]||out.newIngs[slug(it.name)]&&slug(it.name)||null;
          if(!id){const nid=slug(it.name);const nut=["kcal","p","c","f"].every(k=>typeof it[k]==="number");
            if(!nut){r.errors.push(`Unknown ingredient “${it.name}”: give kcal, p, c, f (per 100 g or per piece) so it can be added`);continue}
            out.newIngs[nid]={name:String(it.name).trim(),unit:it.unit==="ks"?"ks":"g",kcal:it.kcal,p:it.p,c:it.c,f:it.f,fib:+it.fib||0,est:it.est!==false};id=nid;r.newIngs.push(it.name)}
          else if(out.newIngs[id]&&!r.newIngs.includes(it.name))r.newIngs.push(it.name)}
        else{r.errors.push("An ingredient has neither ing nor name");continue}}
      if(!(amt>0)){r.errors.push(`Amount missing for ${id||"an ingredient"}`);continue}
      if(!ING[id]&&!out.newIngs[id]){r.errors.push(`Unknown ingredient id “${id}”`);continue}
      items.push([id,amt])}
    if(!items.length&&!r.errors.length)r.errors.push("No ingredients");
    const steps=k=>(Array.isArray(raw[k])?raw[k]:[]).map(s=>String(s).trim()).filter(Boolean);
    const meal={name,cat,prep,keeps:String(raw.keeps||"").trim(),note:String(raw.note||"").trim(),items,prepSteps:steps("prepSteps"),daySteps:steps("daySteps")};
    if(raw.stepBatch>0)meal.stepBatch=+raw.stepBatch;if(raw.stepScale>0)meal.stepScale=+raw.stepScale;if(raw.chicken==="fresh")meal.chicken="fresh";
    // step placeholders must point at ingredients that are in the meal
    for(const s of [...meal.prepSteps,...meal.daySteps])for(const mm of s.matchAll(/\{[=@]([a-z0-9-]+)\}/g))if(!items.some(x=>x[0]===mm[1]))r.errors.push(`Step uses ${mm[0]} but that ingredient isn't in the meal`);
    let id=slug(name);if(used.has(id))id+="-"+(i+1);used.add(id);
    r.id=id;r.meal=meal;r.replaces=!!MEALS[id];out.meals.push(r)});
  return out}
function previewTotals(r,newIngs){const saveING=ING;ING={...ING,...newIngs};const t=macros(r.meal);ING=saveING;return t}
function importHTML(){const p=ui.imp.text.trim()?parseImport(ui.imp.text):null;ui.imp.parsed=p;
  const ok=p&&!p.errors.length&&p.meals.some(m=>!m.errors.length);
  return`<div class="row" style="margin-bottom:12px"><button class="btn" data-back="1">← All meals</button></div>
  <section class="panel"><h2>Import recipes</h2>
  <p class="muted small" style="max-width:70ch">Ask Claude in the chat for recipes “as Meal Prep import JSON”, then paste what it gives you here. Nothing is saved until you press Add. New ingredients are marked <span class="est">est</span> until you check their nutrition on the Ingredients tab.</p>
  <textarea id="imp-text" class="big" placeholder='Paste the JSON here' spellcheck="false">${esc(ui.imp.text)}</textarea>
  <details style="margin-top:8px"><summary class="small" style="cursor:pointer">Show the format</summary><pre class="out">${esc(EXAMPLE)}</pre></details>
  ${p?`<div id="imp-preview">${p.errors.map(e=>`<p class="err">${esc(e)}</p>`).join("")}
  ${p.meals.length?`<div class="scroll"><table><thead><tr><th>Meal</th><th>Type</th><th class="num">kcal</th><th class="num">P / C / F</th><th>Check</th></tr></thead><tbody>${p.meals.map(r=>{const t=r.errors.length?null:previewTotals(r,p.newIngs);const tg=mealTarget(r.meal.cat);const st=t&&tg?rangeStatus(t.kcal,tg.kcal[0],tg.kcal[1]):"";
    return`<tr><td><b>${esc(r.meal.name||"(no name)")}</b>${r.replaces?` <span class="chip near">replaces existing</span>`:""}</td><td>${esc(r.meal.cat||"")} · ${r.meal.prep}</td><td class="num">${t?`<span class="chip ${st}">${Math.round(t.kcal)}</span>`:""}</td><td class="num">${t?`${Math.round(t.p)} / ${Math.round(t.c)} / ${Math.round(t.f)}`:""}</td>
    <td class="small">${r.errors.map(e=>`<div class="err">✗ ${esc(e)}</div>`).join("")}${r.warnings.map(e=>`<div>⚠ ${esc(e)}</div>`).join("")}${r.newIngs.length?`<div>New ingredients (est): ${r.newIngs.map(esc).join(", ")}</div>`:""}${!r.errors.length&&tg&&st!=="on"?`<div>${st==="near"?"Within 10% of":"Outside"} the ${r.meal.cat} kcal target (${tg.kcal[0]}–${tg.kcal[1]})</div>`:""}${!r.errors.length&&!r.warnings.length&&!r.newIngs.length&&st==="on"?`<span class="ok">✓ Looks good</span>`:""}</td></tr>`}).join("")}</tbody></table></div>`:""}
  <div class="actions"><button class="btn primary" id="imp-go" ${ok?"":"disabled"}>Add ${p?p.meals.filter(m=>!m.errors.length).length:0} meal(s)</button><span class="muted small">Meals with a ✗ are skipped.</span></div></div>`:""}</section>`}
function bindImport(){const ta=$("#imp-text");
  ta.oninput=()=>{ui.imp.text=ta.value;clearTimeout(bindImport.t);bindImport.t=setTimeout(()=>{const pos=ta.selectionStart;$("#view").innerHTML=importHTML();bindImport();const n=$("#imp-text");n.focus();n.setSelectionRange(pos,pos)},500)};
  const go=$("#imp-go");if(go)go.onclick=async()=>{const p=ui.imp.parsed;go.disabled=true;
    const good=p.meals.filter(m=>!m.errors.length);const used=new Set(good.flatMap(m=>m.meal.items.map(x=>x[0])));
    let added=0;
    if(Object.keys(p.newIngs).some(id=>used.has(id))){for(const[id,x] of Object.entries(p.newIngs))if(used.has(id)&&!ING[id])ING[id]=x;if(!await putDoc("lib/ingredients",{items:ING})){go.disabled=false;return}}
    for(const m of good){if(await saveMeal(m.id,m.meal))added++}
    toast(`Added ${added} meal${added===1?"":"s"}`);ui.imp=null;render()}}

/* ---------- INGREDIENTS ---------- */
const F=[["kcal","kcal"],["p","Protein"],["c","Carbs"],["f","Fat"],["fib","Fibre"]];
function mergedItems(items,src,tgt,factor){const out=[];let t=-1;
  for(const[id,a] of items||[]){if(id!==src&&id!==tgt){out.push([id,a]);continue}const amt=id===src?Math.round(a*factor*10)/10:a;
    if(t>=0)out[t][1]=Math.round((out[t][1]+amt)*10)/10;else{t=out.length;out.push([tgt,amt])}}return out}
function mergePreview(src,tgt,factor){return Object.entries(MEALS).filter(([,m])=>(m.items||[]).some(([id])=>id===src)).map(([mid,m])=>{const amt=m.items.find(([id])=>id===src)[1];return{mid,name:m.name,amt,b:macros(m),a:macros({...m,items:mergedItems(m.items,src,tgt,factor)})}})}
const remapKey=(k,src,tgt)=>{if(k==="r:"+src)return"r:"+tgt;if(k==="b:"+src)return"b:"+tgt;if(k.startsWith(src+"|"))return tgt+k.slice(src.length);return k};
function remapObj(o,src,tgt){const out={};for(const[k,v] of Object.entries(o||{})){const nk=remapKey(k,src,tgt);if(nk!==k&&nk in o)continue;out[nk]=v}return out}
async function mergeIngredients(src,tgt,factor){
  if(!ING[src]||!ING[tgt]||src===tgt)throw new Error("Pick two different ingredients.");
  for(const[mid,m] of Object.entries(MEALS))if((m.items||[]).some(([id])=>id===src)){const nm={...m,items:mergedItems(m.items,src,tgt,factor)};if(!await saveMeal(mid,nm))throw new Error("a meal couldn't be saved")}
  EDITS=remapObj(EDITS,src,tgt);SWAPS=remapObj(SWAPS,src,tgt);DISMISSED=remapObj(DISMISSED,src,tgt);USEUP=USEUP.map(u=>u.id===src?{...u,id:tgt}:u);
  if(SHOPSET){const S={...SHOPSET};for(const k of["lidlPick","kauflandPick"])if(S[k]&&src in S[k]){S[k]={...S[k]};if(!(tgt in S[k]))S[k][tgt]=S[k][src];delete S[k][src]}SHOPSET=S;await putDoc("settings/shopping",S)}
  delete ING[src];await putDoc("lib/ingredients",{items:ING});flushPlan()}
function mergePanelHTML(){const m=ui.mui,src=m.src,x=ING[src];if(!x)return"";const opts=Object.entries(ING).filter(([id])=>id!==src).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));
  const t=ING[m.tgt];const rows=t?mergePreview(src,m.tgt,m.factor):[];
  return`<section class="panel" id="merge-panel" style="margin:12px 0;border-color:var(--accent)"><h2>Merge ${esc(x.name)}</h2>
  <p class="muted small" style="max-width:70ch;margin:6px 0 10px">Every meal and list entry using ${esc(x.name)} moves to the ingredient you pick, then ${esc(x.name)} is deleted. The kept ingredient's nutrition values are used.</p>
  <div class="form-grid"><label>Merge into<select id="mg-tgt"><option value="">Choose the ingredient to keep…</option>${opts.map(([id,o])=>`<option value="${esc(id)}" ${id===m.tgt?"selected":""}>${esc(o.name)}</option>`).join("")}</select></label>
  ${t?`<label>1 ${x.unit==="ks"?"ks":"g"} of ${esc(x.name)} becomes<span class="row" style="gap:6px"><input id="mg-factor" inputmode="decimal" value="${cz(m.factor)}" style="width:80px"> ${t.unit==="ks"?"ks":"g"} of ${esc(t.name)}</span><span class="small">Leave at 1 when it's the same food. Change it when they differ, e.g. cooked vs raw weight.</span></label>`:""}</div>
  ${t?(rows.length?`<div class="scroll" style="margin-top:12px"><table><thead><tr><th>Meal</th><th class="num">Amount</th><th class="num">kcal</th><th class="num">Protein</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${cz(r.amt)} → ${cz(Math.round(r.amt*m.factor*10)/10)}</td><td class="num">${Math.round(r.b.kcal)} → ${Math.round(r.a.kcal)}</td><td class="num">${Math.round(r.b.p)} → ${Math.round(r.a.p)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin-top:10px">No meals use ${esc(x.name)}.</p>`):""}
  <div class="row" style="margin-top:12px"><button class="btn primary" data-mg="go" ${!t||m.busy?"disabled":""}>${m.busy?"Merging…":"Merge"}</button><button class="btn" data-mg="cancel">Cancel</button></div></section>`}
function ingView(v){const used={};for(const m of Object.values(MEALS))for(const[id] of m.items||[])used[id]=(used[id]||0)+1;
  const list=Object.entries(ING).filter(([,x])=>!ui.estOnly||x.est).sort((a,b)=>a[1].name.localeCompare(b[1].name,"cs"));const nEst=Object.values(ING).filter(x=>x.est).length;
  v.innerHTML=`<p class="muted small" style="max-width:65ch">Values are per 100 g (per piece for items counted in ks). Rows marked <span class="est">est</span> are estimated: check them against the pack and untick “Est” once confirmed. Changes save as you leave each field.</p>
  ${ui.mui?mergePanelHTML():""}
  <div class="row" style="margin-block:10px"><label class="row small"><input type="checkbox" id="estOnly" ${ui.estOnly?"checked":""}> Show only estimated (${nEst})</label><button class="btn" id="addIng">Add ingredient</button></div>
  <div class="scroll panel" style="padding:0"><table class="ingtable"><thead><tr><th>Ingredient</th><th>Unit</th>${F.map(f=>`<th class="num">${f[1]}</th>`).join("")}<th class="c-chk">Est</th><th class="c-chk" title="Bought fresh for Block 2 (bread, rolls)">Bakery</th><th class="c-chk" title="Spice or dried herb: counted in the nutrition, kept off the shopping list">Spice</th><th class="num">Meals</th><th></th></tr></thead><tbody>
  ${list.map(([id,x])=>`<tr data-ing="${esc(id)}"><td class="c-name"><input class="name" data-f="name" value="${esc(x.name)}" title="${esc(x.name)}" aria-label="Name"></td><td data-l="Unit"><select data-f="unit" aria-label="Unit"><option ${x.unit==="g"?"selected":""}>g</option><option ${x.unit==="ks"?"selected":""}>ks</option></select></td>
  ${F.map(([k,l])=>`<td class="num" data-l="${l}"><input inputmode="decimal" data-f="${k}" value="${cz(x[k]??0)}" aria-label="${l}"></td>`).join("")}
  <td class="c-chk" data-l="Est"><input type="checkbox" data-f="est" ${x.est?"checked":""} aria-label="Estimated"></td><td class="c-chk" data-l="Bakery"><input type="checkbox" data-f="bakery" ${x.bakery?"checked":""} aria-label="Block 2 bakery"></td><td class="c-chk" data-l="Spice"><input type="checkbox" data-f="spice" ${x.spice?"checked":""} aria-label="Spice"></td><td class="num" data-l="Meals">${used[id]||0}</td><td class="c-act"><button class="btn tiny" data-mg="open" data-src="${esc(id)}">Merge…</button></tr>`).join("")}</tbody></table></div>`;
  $("#estOnly").onchange=e=>{ui.estOnly=e.target.checked;render()};
  $("#addIng").onclick=()=>{const id="ing-"+Math.random().toString(36).slice(2,8);ING[id]={name:"New ingredient",unit:"g",kcal:0,p:0,c:0,f:0,fib:0,est:true,bakery:false};saveIngs();ui.estOnly=false;render()};
  v.querySelector("tbody").addEventListener("change",e=>{const f=e.target.dataset.f;if(!f)return;const id=e.target.closest("tr").dataset.ing;const x={...ING[id]};
    x[f]=e.target.type==="checkbox"?e.target.checked:(f==="name"||f==="unit")?e.target.value:(czNum(e.target.value)||0);ING[id]=x;saveIngs()})}

/* ---------- TARGETS ---------- */
function targetsView(v){if(!TARGETS){v.innerHTML=`<div class="empty">No targets saved yet. They come across with the data import.</div>`;return}const T=TARGETS;const s=snackTarget();
  const rng=(path,val)=>`<span class="row" style="gap:4px"><input inputmode="decimal" data-t="${path}.0" value="${cz(val[0])}" style="width:72px"> – <input inputmode="decimal" data-t="${path}.1" value="${cz(val[1])}" style="width:72px"></span>`;
  v.innerHTML=`<p class="muted small" style="max-width:65ch">From your nutritionist's plan (${esc(T.source||"")}). When a new assessment comes in, update the numbers here and every check in the planner follows.</p>
  <div class="grid2" style="margin-top:12px">${["breakfast","lunch","dinner"].map(c=>`<section class="panel"><h2>${c[0].toUpperCase()+c.slice(1)}</h2><p class="muted small" style="margin:2px 0 8px">Per serving, shared by both of you</p><table><tbody>
    ${[["kcal","Energy (kcal)"],["c","Carbs (g)"],["p","Protein (g)"],["f","Fat (g)"]].map(([k,l])=>`<tr><td>${l}</td><td>${rng(`meals.${c}.${k}`,T.meals[c][k])}</td></tr>`).join("")}</tbody></table></section>`).join("")}
  ${["kyle","anna"].map(p=>`<section class="panel"><h2>${p==="kyle"?"Kyle":"Annie"}, daily</h2><table><tbody><tr><td>Energy (kcal)</td><td>${rng(`${p}.kcal`,T[p].kcal)}</td></tr>
    ${[["c","Carbs (g)"],["p","Protein (g)"],["f","Fat (g)"],["fib","Fibre min (g)"]].map(([k,l])=>`<tr><td>${l}</td><td><input inputmode="decimal" data-t="${p}.${k}" value="${cz(T[p][k])}" style="width:72px"></td></tr>`).join("")}</tbody></table></section>`).join("")}
  ${s?`<section class="panel"><h2>Kyle's snacks</h2><p class="small">Kyle's daily target minus the three shared meals, split over two snacks. Each snack should land near:</p><p class="bars"><span>${Math.round(s.kcal)} kcal</span><span>P ${Math.round(s.p)}</span><span>C ${Math.round(s.c)}</span><span>F ${Math.round(s.f)}</span></p></section>`:""}</div>
  <div class="actions"><label style="display:grid;gap:4px;font-size:.82rem;color:var(--muted);flex:1 1 260px">Source<input id="t-src" value="${esc(T.source||"")}"></label></div>
  <button class="btn primary" id="t-save">Save targets</button>`;
  $("#t-save").onclick=()=>{const t=JSON.parse(JSON.stringify(TARGETS));document.querySelectorAll("[data-t]").forEach(i=>{const path=i.dataset.t.split(".");let o=t;for(let k=0;k<path.length-1;k++)o=o[path[k]];o[path.at(-1)]=czNum(i.value)||0});t.source=$("#t-src").value.trim()||t.source;saveTargets(t).then(render)}}

/* ---------- events for this file ---------- */
function libChange(t){
  if(t.id==="mg-tgt"){ui.mui.tgt=t.value;ui.mui.factor=1;render()}
  else if(t.id==="mg-factor"){ui.mui.factor=Math.max(0.01,czNum(t.value)||1);render()}}
function libClick(t,d){
  if(d.open){ui.open=d.open;ui.servings=MEALS[d.open]?.cat==="snack"?3:6;render();window.scrollTo(0,0)}
  else if(d.back){ui.open=null;ui.edit=null;ui.imp=null;render()}
  else if(d.cat){ui.cat=d.cat;render()}
  else if(d.sv){ui.servings=Math.max(1,ui.servings+ +d.sv);render()}
  else if(d.editmeal){ui.edit={id:d.editmeal,m:JSON.parse(JSON.stringify(MEALS[d.editmeal]))};render()}
  else if(d.new){ui.edit={id:null,m:{name:"",cat:"lunch",prep:"batch",items:[],prepSteps:[],daySteps:[],keeps:"3 days",note:""}};render()}
  else if(d.act==="openImport"){ui.imp={text:""};render()}
  else if(d.mg==="open"){ui.mui={src:d.src,tgt:"",factor:1,busy:false};render();$("#merge-panel")?.scrollIntoView({block:"start"})}
  else if(d.mg==="cancel"){ui.mui=null;render()}
  else if(d.mg==="go"){const m=ui.mui;if(m.busy)return;const sN=ING[m.src]?.name,tN=ING[m.tgt]?.name;m.busy=true;render();
    mergeIngredients(m.src,m.tgt,m.factor).then(()=>{ui.mui=null;toast(`${sN} merged into ${tN}`)}).catch(e=>{m.busy=false;toast("Merge stopped part-way: "+(e.message||e)+". Press Merge again to finish.")}).finally(render)}
}
