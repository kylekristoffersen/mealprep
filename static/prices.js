/* Meal Prep Planner: Prices tab. Compares this week's online list across Rohlík, Košík and Tesco using pinned products
   (docs products/<id>: {shop, ing, name, url, packG, perKg, usual}). Prices come from the server's check (Rohlík, Košík)
   and from the Tesco bookmark, which runs in your own signed-in Tesco tab. Everything here is plain arithmetic. */
"use strict";
const SHOPS=[["rohlik","Rohlík"],["kosik","Košík"],["tesco","Tesco"]];
const SHOPNAME=Object.fromEntries(SHOPS);
let PRODUCTS={}, PRICES={items:{}};
const pui={open:null,busy:false,prog:null,add:{},search:{},swapsOnly:false};

function loadPrices(docs){PRODUCTS={};for(const[p,d] of Object.entries(docs))if(p.startsWith("products/")&&d.data&&d.data.ing)PRODUCTS[p.slice(9)]=d.data;
  PRICES=docs["state/prices"]?.data||{items:{}};if(!PRICES.items)PRICES.items={}}
const priceSet=()=>({rohlikPremium:true,clubcard:true,...(SHOPSET?.prices||{})});
const usable=x=>x&&!x.blocked&&x.status!=="rejected";
const prodsFor=(ing,shop)=>Object.entries(PRODUCTS).filter(([,x])=>x.ing===ing&&usable(x)&&(!shop||x.shop===shop));
const ageDays=iso=>iso?Math.floor((Date.now()-Date.parse(iso))/864e5):null;
const shopId=x=>{const u=x.url||"";const m=u.match(/rohlik\.cz\/(?:[^?#]*?[/?=])?(\d{6,8})/)||u.match(/kosik\.cz\/p(\d+)/)||u.match(/products\/(\d+)/);return m?m[1]:null};

/* cost of buying `need` (g, or ks for counted ingredients) of one pinned product, from its last price */
function costOf(key,x,need){const r=PRICES.items[key];const ing=ING[x.ing];if(!r||r.error)return{key,x,r,err:r?.error||"not checked yet"};
  if(r.gone)return{key,x,r,err:"no longer sold: pin another product"};
  const set=priceSet();let pack=null,weighed=false;
  if(x.shop==="rohlik"&&r.pack){pack=r.packUnit==="piece"?(ing?.unit==="ks"?r.pack:x.packG):r.pack}
  else if(x.shop==="kosik"&&r.pack&&!x.perKg&&ing?.unit!=="ks")pack=r.pack;
  if(!pack&&!(x.perKg&&x.shop!=="rohlik"))pack=x.packG||null;
  if(!pack&&x.perKg)weighed=true;
  if(!pack&&!weighed)return{key,x,r,err:"pack size unknown: enter it under Pinned products"};
  const options=[{p:r.price,why:""}];
  if(r.memberPrice&&((x.shop==="rohlik"&&set.rohlikPremium)||(x.shop==="kosik"&&set.kosikClub)))options.push({p:r.memberPrice,why:x.shop==="rohlik"?"Premium":"club"});
  if(r.clubcard&&set.clubcard)options.push({p:r.clubcard,why:"Clubcard",until:r.until});
  const packs=weighed?null:Math.max(1,Math.ceil(need/pack-0.02));
  if(r.sale&&(!r.sale.minQty||(packs&&packs>=r.sale.minQty)))options.push({p:r.sale.price,why:r.sale.text||"sale",until:r.sale.until});
  const best=options.filter(o=>o.p>0).sort((a,b)=>a.p-b.p)[0];if(!best)return{key,x,r,err:"no price"};
  let cost,buy;
  if(weighed){const perKg=r.perUnit?r.perUnit*best.p/(r.unitBase||r.price):best.p;cost=need/1000*perKg;buy=`${fmtAmt(need,"g")} by weight`}
  else{cost=packs*best.p;buy=`${packs} × ${fmtAmt(pack,ing?.unit==="ks"?"ks":"g")}`}
  const nearMulti=r.sale?.minQty&&packs&&packs<r.sale.minQty?r.sale:null;
  return{key,x,r,cost,buy,deal:best.why,until:best.until,inStock:r.inStock!==false,left:weighed?0:packs*pack-need,nearMulti}}

/* per ingredient and shop: the usual product if it's in stock, otherwise the cheapest pinned one; cheaper alternatives are only suggested */
function compareRow(item){const out={id:item.id,name:item.name,need:item.amt,unit:item.unit,shops:{}};
  for(const[s] of SHOPS){const all=prodsFor(item.id,s).map(([k,x])=>costOf(k,x,item.amt));if(!all.length){out.shops[s]=null;continue}
    const ok=all.filter(c=>c.cost!=null&&c.inStock).sort((a,b)=>a.cost-b.cost);
    const usual=all.find(c=>c.x.usual);
    let pick=usual&&usual.cost!=null&&usual.inStock?usual:ok[0]||null;
    const note=usual&&pick&&pick!==usual?(usual.err?`usual product: ${usual.err}`:"usual product sold out"):usual&&!pick?(usual.err||"sold out"):"";
    const cheaper=pick&&ok[0]&&ok[0]!==pick&&pick.cost-ok[0].cost>=5?ok[0]:null;
    out.shops[s]={pick,cheaper,note,errs:all.filter(c=>c.err).length,count:all.length,soldOut:!pick&&all.some(c=>c.cost!=null&&!c.inStock)}}
  const priced=SHOPS.map(([s])=>[s,out.shops[s]?.pick?.cost]).filter(([,c])=>c!=null).sort((a,b)=>a[1]-b[1]);
  out.best=priced[0]?.[0]||null;out.spread=priced.length>1?priced[priced.length-1][1]-priced[0][1]:0;return out}

function onlineItems(){const{reg,b2}=shoppingData();return[...reg,...b2]}

function pricesView(v){const items=onlineItems();const rows=items.map(compareRow);const set=priceSet();
  const tot={},miss={};for(const[s] of SHOPS){tot[s]=0;miss[s]=0}
  let split=0,splitMiss=0;for(const r of rows){for(const[s] of SHOPS){const c=r.shops[s]?.pick?.cost;if(c!=null)tot[s]+=c;else miss[s]++}
    if(r.best)split+=r.shops[r.best].pick.cost;else splitMiss++}
  const full=SHOPS.filter(([s])=>!miss[s]).sort((a,b)=>tot[a[0]]-tot[b[0]]);
  const bestSingle=full[0];
  const checked=PRICES.checkedAt,tesco=PRICES.tescoAt,old=d=>d!=null&&d>=2;
  const pinCount=Object.values(PRODUCTS).filter(usable).length;
  const head=`<section class="panel"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h2 style="margin:0">Price check</h2>
    <span class="muted small">${pinCount} pinned products · ${items.length} items on this week's online list</span></div>
    <div class="actions" style="margin:10px 0 6px">
      <button class="btn primary" data-pr="check" ${pui.busy?"disabled":""}>${pui.busy?`Checking… ${pui.prog?`${pui.prog.done}/${pui.prog.total}`:""}`:"Check Rohlík + Košík"}</button>
      <button class="btn" data-pr="tesco">Check Tesco</button>
      <label class="small"><input type="checkbox" data-prset="rohlikPremium" ${set.rohlikPremium?"checked":""}> Rohlík Premium prices</label>
      <label class="small"><input type="checkbox" data-prset="clubcard" ${set.clubcard?"checked":""}> Clubcard prices</label></div>
    <p class="muted small" style="margin:0">Rohlík + Košík: ${checked?`checked ${esc(fmtWhen(checked))}${old(ageDays(checked))?" · <b>out of date, check again</b>":""}`:"not checked yet"} · Tesco: ${tesco?`checked ${esc(fmtWhen(tesco))}${old(ageDays(tesco))?" · <b>out of date</b>":""}`:"not checked yet"}.
    Rohlík shows the prices of its default warehouse; if they differ from what you see signed in, tell Claude.</p>
    ${ui.tescoHelp?tescoHelpHTML():""}</section>`;
  const sum=`<section class="panel" style="margin-top:12px"><h2>This week's online list</h2><div class="tot">
    ${SHOPS.map(([s,n])=>`<div class="${bestSingle&&bestSingle[0]===s?"win":""}"><span class="muted small">All at ${n}</span><b>${Math.round(tot[s])} Kč</b><span class="small ${miss[s]?"warn":"muted"}">${miss[s]?`${miss[s]} item${miss[s]>1?"s":""} not priced`:"everything priced"}</span></div>`).join("")}
    <div><span class="muted small">Cheapest of each</span><b>${Math.round(split)} Kč</b><span class="small muted">${splitMiss?`${splitMiss} not priced anywhere`:"split across shops"}</span></div></div>
    ${bestSingle?`<p class="small" style="margin:8px 0 0">${bestSingle[1]} is the cheapest single shop with everything. Splitting would save <b>${Math.round(tot[bestSingle[0]]-split)} Kč</b>${splitMiss?" on the priced items":""}, before delivery fees.</p>`:`<p class="small muted" style="margin:8px 0 0">No shop has every item priced yet, so the totals aren't like for like. Pin the missing ones below.</p>`}</section>`;
  const cell=(r,s)=>{const c=r.shops[s];if(!c)return`<td class="pc none"><button class="linkbtn small" data-pin="${esc(r.id)}">pin</button></td>`;
    const p=c.pick;if(!p)return`<td class="pc warn"><span class="small">${c.soldOut?"sold out":c.errs?"not priced":"–"}</span>${c.note?`<span class="pn">${esc(c.note)}</span>`:""}</td>`;
    return`<td class="pc ${r.best===s?"win":""}" title="${esc(p.x.name)}"><b>${Math.round(p.cost)} Kč</b><span class="pn">${esc(p.buy)}${p.deal?` · <span class="deal">${esc(p.deal)}</span>`:""}</span>
      ${c.note?`<span class="pn warn">${esc(c.note)}</span>`:""}${p.r.inStock==null&&p.x.shop!=="tesco"?`<span class="pn">stock not shown</span>`:""}${p.nearMulti?`<span class="pn">${esc(p.nearMulti.text)}: ${kc(p.nearMulti.price)} Kč each</span>`:""}
      ${c.cheaper?`<span class="pn swap">cheaper: ${esc(c.cheaper.x.name)} ${Math.round(c.cheaper.cost)} Kč <button class="linkbtn small" data-usual="${esc(c.cheaper.key)}">use this</button></span>`:""}</td>`};
  const list=rows.filter(r=>!pui.swapsOnly||SHOPS.some(([s])=>r.shops[s]?.cheaper||r.shops[s]?.note));
  const table=`<section class="panel" style="margin-top:12px;overflow-x:auto"><div class="row" style="justify-content:space-between"><h2>Item by item</h2>
    <label class="small"><input type="checkbox" data-pr="swaps" ${pui.swapsOnly?"checked":""}> Only items with a note or a cheaper option</label></div>
    <table class="prices"><thead><tr><th>Item</th><th class="num">Need</th>${SHOPS.map(([,n])=>`<th>${n}</th>`).join("")}</tr></thead><tbody>
    ${list.map(r=>`<tr><td><button class="linkbtn" data-pin="${esc(r.id)}">${esc(r.name)}</button>${r.spread>=20?`<span class="pn">saves ${Math.round(r.spread)} Kč at ${SHOPNAME[r.best]}</span>`:""}</td><td class="num">${fmtAmt(r.need,r.unit)}</td>${SHOPS.map(([s])=>cell(r,s)).join("")}</tr>
      ${pui.open===r.id?`<tr><td colspan="5">${pinPanelHTML(r.id)}</td></tr>`:""}`).join("")}
    </tbody></table>${items.length?"":`<p class="muted">The online list is empty. Plan the week first.</p>`}
    <p class="muted small">Amounts are rounded up to whole packs; weighed items are priced by weight. A sale or member price is used when it's cheaper, multi-buy offers only when you'd buy enough. Product swaps are only suggested: press <b>use this</b> to make one your usual.</p></section>`;
  v.innerHTML=head+sum+table}

function fmtWhen(iso){const d=new Date(iso);return d.toLocaleString("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}

function pinPanelHTML(ing){const a=pui.add[ing]||{},sr=pui.search[ing];const rows=prodsFor(ing).sort((x,y)=>x[1].shop.localeCompare(y[1].shop)||(y[1].usual?1:0)-(x[1].usual?1:0));
  return`<div class="pinpanel"><b>Pinned products for ${esc(ING[ing]?.name||ing)}</b>
  ${rows.length?`<ul class="plain">${rows.map(([k,x])=>{const r=PRICES.items[k];return`<li><span class="tape">${SHOPNAME[x.shop]||x.shop}</span> ${x.usual?"★ ":""}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>
    <span class="muted small">${x.packG?fmtAmt(x.packG,ING[ing]?.unit==="ks"?"ks":"g"):x.perKg?"by weight":"pack size?"}${r?.price?` · ${kc(r.price)} Kč`:""}${r?.inStock===false?" · sold out":""}${r?.gone?" · gone":""}</span>
    ${x.usual?"":`<button class="btn tiny" data-usual="${esc(k)}">Make usual</button>`}<input class="tiny" inputmode="numeric" placeholder="pack g" value="${x.packG??""}" data-pack="${esc(k)}" aria-label="Pack size"><button class="btn tiny" data-unpin="${esc(k)}">Remove</button></li>`}).join("")}</ul>`:`<p class="muted small">Nothing pinned yet.</p>`}
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><input style="flex:1;min-width:220px" placeholder="Paste a Rohlík, Košík or Tesco product link" value="${esc(a.url||"")}" data-addurl="${esc(ing)}">
    <button class="btn" data-addgo="${esc(ing)}">Pin</button></div>
  <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><input style="flex:1;min-width:220px" placeholder="Search Rohlík" value="${esc(sr?.q||"")}" data-sq="${esc(ing)}"><button class="btn" data-sgo="${esc(ing)}">Search</button></div>
  ${sr?.items?`<ul class="plain">${sr.items.map((it,i)=>`<li><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.name)}</a> <span class="muted small">${esc(it.amount||"")} · ${kc(it.price)} Kč${it.perUnit?` (${kc(it.perUnit)} Kč/${it.perKg?"kg":"unit"})`:""}</span> <button class="btn tiny" data-spin="${esc(ing)}|${i}">Pin</button></li>`).join("")||"<li class='muted'>No results.</li>"}</ul>`:""}
  ${a.msg?`<p class="small">${esc(a.msg)}</p>`:""}</div>`}

/* ---------- Tesco: a bookmark that runs in your own Tesco tab ---------- */
function tescoRunner(){(async()=>{const H=new URLSearchParams(location.hash.slice(1)),raw=H.get("mpcheck"),back=H.get("mpback");
  const box=document.createElement("div");box.style.cssText="position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;background:#fff;color:#111;border:2px solid #00539f;border-radius:10px;padding:12px 14px;font:14px/1.4 sans-serif;box-shadow:0 4px 20px rgba(0,0,0,.25)";document.body.appendChild(box);
  const say=t=>box.textContent=t;
  if(!raw||!back){say("Meal Prep: open Tesco from the planner's Prices tab (Check Tesco), then press this bookmark.");return}
  const ids=JSON.parse(raw),out={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const grab=(s,re)=>{const m=s.match(re);return m?m[1]:null};
  for(let n=0;n<ids.length;n++){const id=ids[n];say(`Meal Prep: reading Tesco prices ${n+1}/${ids.length}… keep this tab open.`);
    let h="";try{const r=await fetch("/groceries/cs-CZ/products/"+id,{credentials:"include"});
      if(r.status===404){out[id]={gone:true};continue}
      if(!r.ok){say(`Tesco answered ${r.status}; stopped to be safe. ${n} prices read.`);break}
      h=await r.text()}catch(e){say("Network problem; stopped. "+n+" prices read.");break}
    if(/Upozornění|captcha|challenge-platform/i.test(h.slice(0,4000))&&h.indexOf("ProductType:")<0){say("Tesco is asking for a check. Stopped; try again in a few hours. "+n+" prices read.");break}
    const k='"ProductType:'+id+'":{',i=h.indexOf(k);if(i<0){out[id]={error:"not on the page"};continue}
    const s=h.slice(i,i+8000),cut=s.indexOf('"returnDetails"'),head=cut>0?s.slice(0,cut):s.slice(0,2500);
    const act=+grab(s,/"actual":([\d.]+)/)||null;const r={price:act,unitBase:act,perUnit:+grab(s,/"unitPrice":([\d.]+)/)||null,uom:grab(s,/"unitOfMeasure":"(\w+)"/),
      inStock:/"isForSale":true/.test(s)&&grab(s,/"status":"(\w+)"/)==="AvailableForSale",name:JSON.parse('"'+(grab(s,/"title":"((?:[^"\\]|\\.)*)"/)||"")+'"')};
    for(const m of head.matchAll(/PromotionType:\{\\"id\\":\\"(\d+)\\"/g)){let j=-1,p="";
      while((j=h.indexOf('PromotionType:{\\"id\\":\\"'+m[1]+'\\"',j+1))>=0){const t=h.slice(j,j+2500);if(/afterDiscount/.test(t)){p=t;break}}
      if(!p)continue;const before=+grab(p,/"beforeDiscount":([\d.]+)/),after=+grab(p,/"afterDiscount":([\d.]+)/),until=(grab(p,/"endDate":"([\d-]+)/)||"")||null;
      const text=grab(p,/"headline":"((?:[^"\\]|\\.)*)"/)||"";if(!(after>0))continue;
      if(before>0)r.price=before;
      if(/CLUBCARD_PRICING|membership:CZClubcard/.test(p)){if(!r.clubcard||after<r.clubcard){r.clubcard=after;r.until=until}}
      else if(!r.sale||after<r.sale.price)r.sale={price:after,text:JSON.parse('"'+text+'"'),until,minQty:null}}
    out[id]=r;if(n<ids.length-1)await sleep(4000+Math.random()*2000)}
  say("Meal Prep: done, taking you back to the planner…");
  location.href=back+"#prices&tesco="+encodeURIComponent(JSON.stringify({at:new Date().toISOString(),items:out}))})()}
const tescoBookmark=()=>"javascript:"+encodeURIComponent("("+tescoRunner.toString()+")()");
function tescoIds(){const ings=new Set(onlineItems().map(x=>x.id));return[...new Set(Object.values(PRODUCTS).filter(x=>usable(x)&&x.shop==="tesco"&&ings.has(x.ing)).map(shopId).filter(Boolean))]}
function tescoHelpHTML(){const ids=tescoIds();const go=`https://nakup.itesco.cz/groceries/cs-CZ/#mpcheck=${encodeURIComponent(JSON.stringify(ids))}&mpback=${encodeURIComponent(location.origin+location.pathname)}`;
  return`<div class="pinpanel" style="margin-top:10px"><b>Tesco check (on a computer)</b>
  <ol class="small" style="margin:6px 0 0;padding-left:20px;line-height:1.6">
   <li>One time only: drag this button to your bookmarks bar: <a class="btn tiny" href="${esc(tescoBookmark())}" onclick="event.preventDefault();toast('Drag it to the bookmarks bar instead of clicking.')">Meal Prep: Tesco prices</a></li>
   <li><a href="${esc(go)}" target="_blank" rel="noopener">Open Tesco</a> (${ids.length} products on this week's list) and sign in if it asks, so Clubcard prices show.</li>
   <li>On that Tesco tab, press the <b>Meal Prep: Tesco prices</b> bookmark. It reads one product every 4–6 seconds (about ${Math.max(1,Math.round(ids.length*5/60))} min), then brings you back here with the prices.</li></ol>
  <p class="muted small" style="margin:6px 0 0">It only reads product pages, slowly, and stops on its own if Tesco shows a warning.</p></div>`}

async function takeTescoResult(raw){let res;try{res=JSON.parse(raw)}catch(e){toast("The Tesco prices couldn't be read.");return}
  const items={...(PRICES.items||{})};let n=0;
  for(const[k,x] of Object.entries(PRODUCTS)){if(x.shop!=="tesco")continue;const r=res.items?.[shopId(x)];if(!r)continue;items[k]={...r,at:res.at};n++}
  PRICES={...PRICES,items,tescoAt:res.at};await putDoc("state/prices",PRICES);
  const named=Object.entries(PRODUCTS).filter(([,x])=>x.shop==="tesco"&&!x.name&&res.items?.[shopId(x)]?.name);
  for(const[k,x] of named)await putDoc("products/"+k,{...x,name:res.items[shopId(x)].name});
  toast(`Tesco prices saved for ${n} pinned products`);render()}

/* ---------- actions ---------- */
async function runCheck(){if(pui.busy)return;pui.busy=true;pui.prog=null;render();
  try{const r=await fetch("/api/prices/check",{method:"POST",headers:jhead,body:JSON.stringify({ings:onlineItems().map(x=>x.id)})});if(!r.ok)throw new Error("HTTP "+r.status);
    for(let i=0;i<180;i++){await new Promise(z=>setTimeout(z,1500));const s=await (await fetch("/api/prices/status")).json();pui.prog=s;if(tab==="prices")render();if(!s.running){if(s.error)toast("Price check problem: "+s.error);break}}
    await reloadAll();toast("Prices updated")}catch(e){toast("Couldn't check prices: "+(e.message||e))}finally{pui.busy=false;render()}}
async function setUsual(key){const x=PRODUCTS[key];if(!x)return;for(const[k,y] of prodsFor(x.ing,x.shop))if(y.usual&&k!==key)await putDoc("products/"+k,{...y,usual:false});
  await putDoc("products/"+key,{...x,usual:true});loadPrices(DOCS);render();toast(`${x.name} is now your usual at ${SHOPNAME[x.shop]}`)}
async function pinProduct(ing,info){if(!info?.shop||!info.id)return;const key=info.shop[0]+info.id+"-"+ing.slice(0,24).replace(/[^a-z0-9-]/g,"");
  const first=!prodsFor(ing,info.shop).length;const data={shop:info.shop,ing,name:info.name||`${SHOPNAME[info.shop]} product ${info.id}`,url:info.url,packG:info.packG||null,perKg:!!info.perKg,usual:first,status:"ok"};
  if(await putDoc("products/"+key,data)){loadPrices(DOCS);pui.add[ing]={msg:`Pinned at ${SHOPNAME[info.shop]}${data.packG||data.perKg?"":": enter its pack size"}${info.shop==="tesco"?". Its price comes with the next Tesco check":". Its price comes with the next check"}.`};render()}}

document.addEventListener("click",async e=>{const t=e.target.closest("[data-pr],[data-pin],[data-usual],[data-unpin],[data-addgo],[data-sgo],[data-spin]");if(!t||tab!=="prices")return;const d=t.dataset;
  if(d.pr==="check")runCheck();
  else if(d.pr==="tesco"){ui.tescoHelp=!ui.tescoHelp;render()}
  else if(d.pr==="swaps"){pui.swapsOnly=t.checked;render()}
  else if(d.pin!==undefined){pui.open=pui.open===d.pin?null:d.pin;render()}
  else if(d.usual)setUsual(d.usual);
  else if(d.unpin){const x=PRODUCTS[d.unpin];if(x&&await delDoc("products/"+d.unpin)){loadPrices(DOCS);render();toast(`Removed ${x.name}`)}}
  else if(d.addgo){const ing=d.addgo,url=(document.querySelector(`[data-addurl="${CSS.escape(ing)}"]`)?.value||"").trim();pui.add[ing]={url,msg:"Looking it up…"};render();
    try{const r=await fetch("/api/products/lookup",{method:"POST",headers:jhead,body:JSON.stringify({url})});const j=await r.json();if(!r.ok)throw new Error(j.error||"HTTP "+r.status);await pinProduct(ing,j)}
    catch(er){pui.add[ing]={url,msg:er.message||String(er)};render()}}
  else if(d.sgo){const ing=d.sgo,q=(document.querySelector(`[data-sq="${CSS.escape(ing)}"]`)?.value||"").trim();pui.search[ing]={q,items:null};
    try{const j=await (await fetch("/api/products/search?q="+encodeURIComponent(q))).json();pui.search[ing]={q,items:j.items||[]};if(j.error)toast(j.error)}catch(er){toast("Search failed")}render()}
  else if(d.spin){const[ing,i]=d.spin.split("|");const it=pui.search[ing]?.items?.[+i];if(it)await pinProduct(ing,it)}});
document.addEventListener("change",async e=>{const t=e.target;if(tab!=="prices")return;
  if(t.dataset.prset){const S={...(SHOPSET||{})};S.prices={...priceSet(),[t.dataset.prset]:t.checked};SHOPSET=S;render();await putDoc("settings/shopping",S)}
  else if(t.dataset.pack){const k=t.dataset.pack,x=PRODUCTS[k];if(!x)return;const v=czNum(t.value);await putDoc("products/"+k,{...x,packG:v>0?v:null});loadPrices(DOCS);render()}});
