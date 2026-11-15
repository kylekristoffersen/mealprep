"""Merging two ingredients moves their pinned shop products and last prices. App running on MEALPREP_URL with sample data + shop-products update."""
import os
from playwright.sync_api import sync_playwright
URL=os.environ.get("MEALPREP_URL","http://localhost:5020");fails=[];errs=[]
def check(n,ok,i=""):
    print(("PASS " if ok else "FAIL ")+n+("" if ok else " "+str(i)));ok or fails.append(n)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome",args=["--no-sandbox"]);pg=b.new_page();pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto(URL);pg.wait_for_selector("#tabs button")
    # make a throwaway ingredient pinned at the same product as an existing one (duplicate) plus a product of its own
    tgt=pg.evaluate("Object.keys(ING).find(i=>Object.values(PRODUCTS).some(x=>x.ing===i&&x.shop==='tesco'))");src="zz-merge-test"
    pg.evaluate(f"""(async()=>{{ING['{src}']={{...ING['{tgt}'],name:'ZZ merge test'}};await putDoc('lib/ingredients',{{items:ING}});
      const d=Object.values(PRODUCTS).find(x=>x.ing==='{tgt}'&&x.shop==='tesco');
      await putDoc('products/t'+shopId(d)+'-{src}',{{...d,ing:'{src}',usual:true}});
      await putDoc('products/r9999999-{src}',{{shop:'rohlik',ing:'{src}',name:'Own product',url:'https://www.rohlik.cz/9999999-x',packG:250,usual:true,status:'ok'}});
      loadPrices(DOCS)}})()""");pg.wait_for_timeout(800)
    before=pg.evaluate(f"Object.entries(PRODUCTS).filter(([,x])=>x.ing==='{src}').map(([k,x])=>[k,x.shop,shopId(x)])")
    tgt0=pg.evaluate(f"Object.entries(PRODUCTS).filter(([,x])=>x.ing==='{tgt}').map(([k,x])=>x.shop+shopId(x))")
    pg.evaluate(f"(async()=>{{const k=Object.keys(PRODUCTS).find(k=>PRODUCTS[k].ing==='{src}'&&PRODUCTS[k].shop==='rohlik');PRICES.items[k]={{price:42,at:new Date().toISOString()}};await putDoc('state/prices',PRICES)}})()");pg.wait_for_timeout(300)
    pg.evaluate(f"mergeIngredients('{src}','{tgt}',1)");pg.wait_for_timeout(2500)
    pg.reload();pg.wait_for_selector("#tabs button")
    left=pg.evaluate(f"Object.values(PRODUCTS).filter(x=>x.ing==='{src}').length");check("no products left on old ingredient",left==0,left)
    after=pg.evaluate(f"Object.entries(PRODUCTS).filter(([,x])=>x.ing==='{tgt}').map(([k,x])=>x.shop+shopId(x))")
    want=set(tgt0)|{s+i for _,s,i in before};check("all products now on kept ingredient, no duplicates",set(after)==want and len(after)==len(set(after)),(after,want))
    usual=pg.evaluate(f"['rohlik','kosik','tesco'].map(s=>Object.values(PRODUCTS).filter(x=>x.ing==='{tgt}'&&x.shop===s&&x.usual).length)");check("at most one usual per shop",max(usual)<=1,usual)
    check("price moved",pg.evaluate("Object.values(PRICES.items).some(r=>r.price===42)"))
    check("ingredient gone",pg.evaluate(f"!ING['{src}']"))
    b.close()
print("errors:",errs,"FAILED:",fails or "none")
