"""Prices tab: 'needs pin' colouring and the temporary 'not sold here' mark. App running on MEALPREP_URL with sample data imported."""
import os
from playwright.sync_api import sync_playwright
URL=os.environ.get("MEALPREP_URL","http://localhost:5020");fails=[];errs=[]
def check(n,ok,i=""):
    print(("PASS " if ok else "FAIL ")+n+("" if ok else " "+str(i)));ok or fails.append(n)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"])
    for vw in [(1280,900),(390,844)]:
        pg=b.new_page(viewport={"width":vw[0],"height":vw[1]});pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.goto(URL);pg.wait_for_selector("#tabs button")
        if vw[0]==1280:pg.click("[data-act=randAll]");pg.wait_for_timeout(800)
        pg.click("[data-tabgo=prices]");pg.wait_for_timeout(300)
        n0=pg.locator("td.needpin").count();check("needs-pin cells coloured",n0>0,n0)
        if vw[0]==1280:
            row=pg.locator("tr:has(td.needpin)").first;name=row.locator("td:first-child .linkbtn").inner_text()
            row.locator("[data-ns]").first.click();pg.wait_for_timeout(500)
            check("cell becomes not sold",pg.locator("td.notsold").count()==1)
            check("one fewer needs-pin",pg.locator("td.needpin").count()==n0-1)
            check("total card says not sold here","1 not sold here" in pg.inner_text(".tot"),pg.inner_text(".tot"))
            pg.reload();pg.wait_for_selector("#tabs button");pg.click("[data-tabgo=prices]");pg.wait_for_timeout(300)
            check("mark survives reload",pg.locator("td.notsold").count()==1)
            pg.screenshot(path="/tmp/shot-notsold.png",full_page=True)
            pg.click("td.notsold [data-nsoff]");pg.wait_for_timeout(400)
            check("undo works",pg.locator("td.notsold").count()==0 and pg.locator("td.needpin").count()==n0)
            # expired mark is ignored
            pg.evaluate("NOTSOLD={'x|tesco':{until:'2020-01-01T00:00:00Z'}};render()")
            check("expired mark ignored",pg.locator("td.notsold").count()==0)
        else:
            pg.screenshot(path="/tmp/shot-notsold-m.png",full_page=True)
            ov=pg.evaluate("document.querySelector('main').scrollWidth-document.querySelector('main').clientWidth");check("no sideways page scroll",ov<=1,ov)
        pg.close()
    b.close()
print("errors:",errs,"FAILED:",fails or "none")
