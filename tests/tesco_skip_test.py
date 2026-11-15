"""Tesco check skips products already priced today. App running on MEALPREP_URL with sample data imported (and the shop-products data update applied)."""
import json, urllib.parse, datetime
from playwright.sync_api import sync_playwright
import os
URL=os.environ.get("MEALPREP_URL","http://localhost:5020");fails=[];errs=[]
def check(n,ok,i=""):
    print(("PASS " if ok else "FAIL ")+n+("" if ok else " "+str(i)));ok or fails.append(n)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"]);pg=b.new_page(viewport={"width":1280,"height":900})
    pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(URL);pg.wait_for_selector("#tabs button");pg.click("[data-act=randAll]");pg.wait_for_timeout(800)
    pg.click("[data-tabgo=prices]");pg.wait_for_timeout(300)
    before=pg.evaluate("tescoIdsSplit()");print("before",before)
    check("some tesco ids to check",len(before["todo"])>=2)
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    a,c=before["todo"][0],before["todo"][1]
    res={"at":now,"items":{a:{"price":29.9,"inStock":True,"name":"X"},c:{"error":"not on the page"}}}
    pg.goto("about:blank");pg.goto(URL+"/#prices&tesco="+urllib.parse.quote(json.dumps(res)));pg.wait_for_timeout(1500)
    after=pg.evaluate("tescoIdsSplit()");print("after",after)
    check("priced today is skipped",a not in after["todo"] and a in after["fresh"])
    check("error retried",c in after["todo"])
    pg.click("[data-pr=tesco]");pg.wait_for_timeout(200)
    t=pg.inner_text(".pinpanel");check("help says skipped","already checked today is skipped" in t,t)
    href=pg.get_attribute(".pinpanel a[target=_blank]","href");ids=json.loads(urllib.parse.unquote(href.split("mpcheck=")[1].split("&")[0]))
    check("link excludes fresh",a not in ids and c in ids,ids)
    # yesterday's price is checked again
    old=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).isoformat()
    pg.goto("about:blank");pg.goto(URL+"/#prices&tesco="+urllib.parse.quote(json.dumps({"at":old,"items":{a:{"price":29.9,"inStock":True}}})));pg.wait_for_timeout(1500)
    check("yesterday rechecked",a in pg.evaluate("tescoIds()"))
    # everything fresh -> nothing-to-check message
    allres={"at":now,"items":{i:{"price":10,"inStock":True} for i in after["todo"]+after["fresh"]}}
    pg.goto("about:blank");pg.goto(URL+"/#prices&tesco="+urllib.parse.quote(json.dumps(allres)));pg.wait_for_timeout(1500)
    pg.click("[data-pr=tesco]");pg.wait_for_timeout(200)
    t=pg.inner_text(".pinpanel");check("nothing-to-check shown","Nothing to check" in t,t)
    pg.screenshot(path="/tmp/tesco-skip.png")
    b.close()
print("errors:",errs,"FAILED:",fails or "none")
