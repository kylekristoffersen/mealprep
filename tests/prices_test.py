"""Prices tab smoke test. App running on MEALPREP_URL with sample data imported (and the shop-products data update applied)."""
import os, json, urllib.parse
from playwright.sync_api import sync_playwright
URL=os.environ.get("MEALPREP_URL","http://localhost:5020")
errs=[];fails=[]
def check(name,ok,info=""):
    print(("PASS " if ok else "FAIL ")+name+(" "+str(info) if info and not ok else ""))
    if not ok:fails.append(name)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    for vw in [(390,844),(1280,900)]:
        ctx=b.new_context(viewport={"width":vw[0],"height":vw[1]})
        pg=ctx.new_page();pg.on("pageerror",lambda e:errs.append(str(e)));pg.on("console",lambda m:m.type=="error" and errs.append(m.text))
        pg.goto(URL);pg.wait_for_selector("#tabs button")
        pg.click("[data-act=randAll]");pg.wait_for_timeout(800)
        pg.click("[data-tabgo=prices]");pg.wait_for_timeout(300)
        check("prices tab shows rows",pg.locator("table.prices tbody tr").count()>2)
        if vw[0]==390:
            pg.click("[data-pr=check]");pg.wait_for_function("!document.querySelector('[data-pr=check]').disabled",timeout=180000)
            check("check fills prices",pg.locator("td.pc b").count()>3,pg.locator("td.pc b").count())
            check("cheapest marked",pg.locator("td.pc.win").count()>0)
        pg.screenshot(path=f"/tmp/shot-prices-{vw[0]}.png",full_page=True)
        ov=pg.evaluate("document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth")
        check("no page-level sideways scroll",ov<=1,ov)
        ctx.close()
    # Tesco hand-off: pretend the bookmark came back with prices
    ctx=b.new_context(viewport={"width":1280,"height":900});pg=ctx.new_page();pg.on("pageerror",lambda e:errs.append(str(e)))
    res={"at":"2026-11-15T11:00:00Z","items":{"212124270":{"price":219.9,"clubcard":109.9,"perUnit":219.9,"unitBase":219.9,"uom":"kg","inStock":True,"name":"Tesco Kuřecí prsní řízek"},
        "100501435":{"price":29.9,"unitBase":29.9,"perUnit":29.9,"inStock":True,"name":"Tesco Rýže"}}}
    pg.goto(URL+"/#prices&tesco="+urllib.parse.quote(json.dumps(res)));pg.wait_for_timeout(1500)
    check("hash cleaned",pg.evaluate("location.hash")=="#prices",pg.evaluate("location.hash"))
    st=pg.evaluate("fetch('/api/all').then(r=>r.json()).then(j=>j.docs['state/prices'].data)")
    check("tesco prices saved",st.get("tescoAt")=="2026-11-15T11:00:00Z" and st["items"].get("t212124270-kureci-prsa",{}).get("clubcard")==109.9)
    txt=pg.inner_text("table.prices")
    check("tesco column has a price",any("Kč" in c for c in pg.eval_on_selector_all("table.prices tbody tr td:nth-child(5)","e=>e.map(x=>x.innerText)")))
    pg.click("[data-pr=tesco]");pg.wait_for_timeout(200)
    href=pg.get_attribute("a.btn.tiny[href^='javascript:']","href")
    check("bookmark link built",href and len(href)>500)
    # pin flow
    first=pg.locator("table.prices tbody tr td:first-child [data-pin]").first;first.click();pg.wait_for_timeout(200)
    check("pin panel opens",pg.locator(".pinpanel").count()>0)
    pg.screenshot(path="/tmp/shot-prices-tesco.png",full_page=True)
    b.close()
print("errors:",errs);print("FAILED:",fails or "none")
