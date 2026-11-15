/* Read-only Cook page for Annie: opened through a secret link, no password. Shows only the cooking views. */
"use strict";
const $=s=>document.querySelector(s);
const token=location.pathname.split("/").pop();
let mode=(location.hash||"").slice(1);const MODES=[["prep","Prep day"],["day","Each day"],["week","This week's recipes"],["safety","Food safety"]];
if(!MODES.some(m=>m[0]===mode))mode="prep";
let lastSig="";
function draw(){reconcile();
  $("#tabs").innerHTML=MODES.map(([k,l])=>`<button role="tab" aria-selected="${k===mode}" data-m="${k}">${l}</button>`).join("");
  $("#view").innerHTML=mode==="prep"?prepHTML():mode==="day"?eachDayHTML():mode==="week"?weekRecipesHTML():safetyHTML(false);applyTicks($("#view"))}
async function load(){
  try{const r=await fetch("/api/cook/"+token);if(!r.ok)throw new Error(r.status===404?"This link isn't valid any more. Ask Kyle for the new one.":"HTTP "+r.status);
    const j=await r.json();const sig=JSON.stringify(Object.entries(j.docs).map(([p,d])=>[p,d.version]));
    $("#ver").textContent="v"+j.appVersion;
    if(sig!==lastSig){lastSig=sig;loadDocs(j.docs);$("#status").textContent=Object.keys(MEALS).length?"":"Nothing planned yet.";draw()}}
  catch(e){$("#status").textContent=e.message||"Couldn't load."}}
document.addEventListener("click",e=>{const b=e.target.closest("[data-m]");if(!b)return;mode=b.dataset.m;try{history.replaceState(null,"","#"+mode)}catch(_){}draw();window.scrollTo({top:0})});
load();setInterval(()=>{if(!document.hidden)load()},30000);
