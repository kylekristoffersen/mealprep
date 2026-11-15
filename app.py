"""Meal Prep Planner: small Flask app. Stores everything as JSON documents in one SQLite file.

Logins are handled by the app itself: an in-page sign-in form (/login) checked against the nginx-style
password file (two users), then a signed session cookie. nginx no longer asks for a password.
The only pages open without a login are the sign-in page, the static files and the read-only Cook page
behind a secret link (/cook/<token>).
When the password file does not exist (local development) the login is switched off and the user is "dev".
"""
import json, os, secrets, sqlite3, subprocess, threading, time, datetime, re, shutil, hashlib
from flask import Flask, request, jsonify, send_from_directory, abort, Response, redirect, g
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
try:
    import bcrypt
except ImportError:  # falls back to the htpasswd program
    bcrypt = None

APP_VERSION = "0.6.10"
DATA_DIR = os.environ.get("MEALPREP_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_data"))
PORT = int(os.environ.get("MEALPREP_PORT", "5020"))
HTPASSWD = os.environ.get("MEALPREP_HTPASSWD", "/etc/nginx/.mealprep-htpasswd")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DB_PATH = os.path.join(DATA_DIR, "mealprep.db")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
BACKUP_KEEP = 14
COOKIE = "mp_session"
SESSION_DAYS = 30
USER_RE = re.compile(r"^[a-z0-9_-]{1,32}$")

app = Flask(__name__, static_folder=None)
_lock = threading.Lock()
PATH_RE = re.compile(r"^[a-z0-9_-]+(/[A-Za-z0-9_.-]+)?$")


def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    with db() as c:
        c.execute("CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT, updated_by TEXT)")
        c.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        if not c.execute("SELECT 1 FROM kv WHERE k='cook_token'").fetchone():
            c.execute("INSERT INTO kv VALUES('cook_token',?)", (secrets.token_urlsafe(18),))


def now():
    return datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"


def auth_on():
    return os.environ.get("MEALPREP_AUTH") != "off" and os.path.exists(HTPASSWD)


def user():
    if auth_on():
        return getattr(g, "user", None) or ""
    return os.environ.get("MEALPREP_DEV_USER", "dev")


# ---- sign-in: password file check, signed session cookie, small brute-force brake ----
def htpasswd_line(u):
    try:
        with open(HTPASSWD, encoding="utf-8") as f:
            for line in f:
                name, _, h = line.rstrip("\n").partition(":")
                if name == u:
                    return h
    except OSError:
        pass
    return None


def check_password(u, pw):
    h = htpasswd_line(u)
    if not h or not pw:
        return False
    if bcrypt and h[:4] in ("$2y$", "$2a$", "$2b$"):
        try:
            return bcrypt.checkpw(pw.encode()[:72], h.encode())
        except ValueError:
            return False
    try:  # other hash types: ask the htpasswd program
        return subprocess.run(["htpasswd", "-v", "-i", HTPASSWD, u], input=pw.encode(), capture_output=True, timeout=20).returncode == 0
    except Exception:
        return False


def session_secret():
    with db() as c:
        r = c.execute("SELECT v FROM kv WHERE k='session_secret'").fetchone()
        if r:
            return r[0]
        v = secrets.token_hex(32)
        c.execute("INSERT INTO kv VALUES('session_secret',?)", (v,))
        return v


def _serializer():
    return URLSafeTimedSerializer(session_secret(), salt="mealprep-session")


def pw_stamp(u):  # changes when the person's password changes, which signs out their other devices
    return hashlib.sha256((htpasswd_line(u) or "").encode()).hexdigest()[:12]


def make_cookie_value(u):
    return _serializer().dumps({"u": u, "p": pw_stamp(u)})


def session_user():
    tok = request.cookies.get(COOKIE)
    if not tok:
        return None
    try:
        d = _serializer().loads(tok, max_age=SESSION_DAYS * 86400)
    except (BadSignature, SignatureExpired):
        return None
    u = d.get("u", "")
    if USER_RE.match(u) and htpasswd_line(u) is not None and d.get("p") == pw_stamp(u):
        return u
    return None


def set_session(resp, u):
    resp.set_cookie(COOKIE, make_cookie_value(u), max_age=SESSION_DAYS * 86400, httponly=True, samesite="Lax",
                    secure=request.headers.get("X-Forwarded-Proto", request.scheme) == "https", path="/")
    return resp


_fails = {}  # client address -> recent failure times
def client_ip():
    return request.headers.get("X-Real-IP") or request.remote_addr or "?"


def too_many_fails(ip):
    t = time.time()
    _fails[ip] = [x for x in _fails.get(ip, []) if t - x < 600]
    return len(_fails[ip]) >= 8


PUBLIC_RE = re.compile(r"^/(login|logout|api/health|static/.+|cook/[A-Za-z0-9_-]+|api/cook/[A-Za-z0-9_-]+)$")


@app.before_request
def gate():
    if not auth_on():
        return None
    if PUBLIC_RE.match(request.path):
        return None
    u = session_user()
    if u:
        g.user = u
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Please sign in again."}), 401
    return redirect("/login")


@app.get("/login")
def login_page():
    if not auth_on() or session_user():
        return redirect("/")
    return send_from_directory(STATIC, "login.html")


@app.post("/login")
def login_submit():
    ip = client_ip()
    if too_many_fails(ip):
        return redirect("/login?e=wait")
    u = (request.form.get("username") or "").strip().lower()
    pw = request.form.get("password") or ""
    if auth_on() and USER_RE.match(u) and check_password(u, pw):
        _fails.pop(ip, None)
        return set_session(redirect("/"), u)
    _fails.setdefault(ip, []).append(time.time())
    time.sleep(0.6)
    return redirect("/login?e=bad")


@app.post("/logout")
def logout():
    resp = redirect("/login")
    resp.delete_cookie(COOKIE, path="/")
    return resp


def all_docs():
    with db() as c:
        return {r["path"]: {"data": json.loads(r["data"]), "version": r["version"], "by": r["updated_by"], "at": r["updated_at"]}
                for r in c.execute("SELECT * FROM docs")}


def cook_token():
    with db() as c:
        return c.execute("SELECT v FROM kv WHERE k='cook_token'").fetchone()[0]


def snapshot_json():
    d = all_docs()
    return {"app": "mealprep", "exportedAt": now(), "docs": {p: v["data"] for p, v in d.items()}}


def write_backup(tag="auto"):
    name = f"mealprep-{datetime.datetime.utcnow().strftime('%Y%m%d-%H%M%S')}-{tag}.json"
    with open(os.path.join(BACKUP_DIR, name), "w", encoding="utf-8") as f:
        json.dump(snapshot_json(), f, ensure_ascii=False)
    files = sorted(x for x in os.listdir(BACKUP_DIR) if x.endswith(".json"))
    # keep the newest BACKUP_KEEP automatic ones; manual/pre-import ones are kept longer
    auto = [x for x in files if x.endswith("-auto.json")]
    for old in auto[:-BACKUP_KEEP]:
        os.remove(os.path.join(BACKUP_DIR, old))
    return name


def backup_loop():
    last = None
    while True:
        time.sleep(600)
        today = datetime.date.today().isoformat()
        if last != today and datetime.datetime.now().hour >= 3:
            try:
                write_backup("auto")
                last = today
            except Exception as e:  # never kill the thread
                print("backup failed:", e)


@app.after_request
def nocache(r):
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


@app.get("/static/<path:f>")
def static_files(f):
    return send_from_directory(STATIC, f)


@app.get("/api/all")
def api_all():
    d = all_docs()
    return jsonify({"docs": d, "user": user(), "appVersion": APP_VERSION})


@app.put("/api/doc/<path:path>")
def api_put(path):
    if not PATH_RE.match(path):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    if "data" not in body:
        abort(400)
    expect = body.get("version")  # version the client last saw; 0 for a new doc; None = force
    with _lock, db() as c:
        row = c.execute("SELECT version FROM docs WHERE path=?", (path,)).fetchone()
        cur = row["version"] if row else 0
        if expect is not None and expect != cur:
            return jsonify({"error": "conflict", "version": cur}), 409
        nv = cur + 1
        c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES(?,?,?,?,?) "
                  "ON CONFLICT(path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                  (path, json.dumps(body["data"], ensure_ascii=False), nv, now(), user()))
    return jsonify({"version": nv})


@app.delete("/api/doc/<path:path>")
def api_delete(path):
    if not PATH_RE.match(path):
        abort(400)
    with _lock, db() as c:
        c.execute("DELETE FROM docs WHERE path=?", (path,))
    return jsonify({"ok": True})


@app.post("/api/import")
def api_import():
    """Whole-data import (from the artifact's Export button, or a backup). Takes a backup first."""
    body = request.get_json(force=True, silent=True) or {}
    docs = body.get("docs")
    if not isinstance(docs, dict) or not docs:
        return jsonify({"error": "This file doesn't look like a Meal Prep export (no 'docs')."}), 400
    for p in docs:
        if not PATH_RE.match(p):
            return jsonify({"error": f"Unexpected item name: {p}"}), 400
    mode = body.get("mode", "merge")  # merge keeps documents not in the file; replace wipes first
    with _lock:
        pre = write_backup("before-import")
        with db() as c:
            if mode == "replace":
                c.execute("DELETE FROM docs")
            for p, data in docs.items():
                row = c.execute("SELECT version FROM docs WHERE path=?", (p,)).fetchone()
                nv = (row["version"] if row else 0) + 1
                c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES(?,?,?,?,?) "
                          "ON CONFLICT(path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                          (p, json.dumps(data, ensure_ascii=False), nv, now(), user()))
    return jsonify({"imported": len(docs), "backup": pre})


@app.get("/api/backup")
def api_backup():
    data = json.dumps(snapshot_json(), ensure_ascii=False, indent=1)
    fn = f"mealprep-backup-{datetime.date.today().isoformat()}.json"
    return Response(data, mimetype="application/json", headers={"Content-Disposition": f"attachment; filename={fn}"})


@app.get("/api/backups")
def api_backups():
    files = sorted((x for x in os.listdir(BACKUP_DIR) if x.endswith(".json")), reverse=True)
    return jsonify({"files": files[:30]})


@app.post("/api/backup-now")
def api_backup_now():
    return jsonify({"file": write_backup("manual")})


@app.post("/api/restore/<name>")
def api_restore(name):
    if not re.match(r"^mealprep-[0-9-]+-[a-z-]+\.json$", name):
        abort(400)
    p = os.path.join(BACKUP_DIR, name)
    if not os.path.isfile(p):
        abort(404)
    with open(p, encoding="utf-8") as f:
        snap = json.load(f)
    with _lock:
        pre = write_backup("before-restore")
        with db() as c:
            c.execute("DELETE FROM docs")
            for path, data in snap["docs"].items():
                c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES(?,?,1,?,?)", (path, json.dumps(data, ensure_ascii=False), now(), user()))
    return jsonify({"restored": name, "backup": pre})


# ---- read-only Cook page behind a secret link (no password) ----
@app.get("/api/cook-link")
def api_cook_link():
    return jsonify({"path": "/cook/" + cook_token()})


@app.post("/api/cook-link/new")
def api_cook_link_new():
    with db() as c:
        c.execute("UPDATE kv SET v=? WHERE k='cook_token'", (secrets.token_urlsafe(18),))
    return jsonify({"path": "/cook/" + cook_token()})


@app.get("/cook/<token>")
def cook_page(token):
    if not secrets.compare_digest(token, cook_token()):
        abort(404)
    return send_from_directory(STATIC, "cook.html")


@app.get("/api/cook/<token>")
def cook_data(token):
    if not secrets.compare_digest(token, cook_token()):
        abort(404)
    d = all_docs()
    keep = {p: v for p, v in d.items() if p == "lib/ingredients" or p == "state/plan" or p.startswith("meals/") or p == "settings/safety"}
    return jsonify({"docs": keep, "appVersion": APP_VERSION})


# ---- change my own password (writes the nginx password file) ----
@app.post("/api/password")
def api_password():
    body = request.get_json(force=True, silent=True) or {}
    pw = str(body.get("password", ""))
    u = user()
    if len(pw) < 8:
        return jsonify({"error": "Use at least 8 characters."}), 400
    if not re.match(r"^[a-z0-9_-]+$", u) or u == "dev":
        return jsonify({"error": "Passwords can only be changed on the live site."}), 400
    try:
        subprocess.run(["htpasswd", "-i", "-B", HTPASSWD, u], input=pw.encode(), check=True, capture_output=True, timeout=20)
    except Exception as e:
        return jsonify({"error": "Couldn't change the password on this server."}), 500
    return set_session(jsonify({"ok": True}), u)  # keep this device signed in; other devices must sign in again


# ---- server status for Settings: what is running and why an update or the nginx switch did not happen ----
APP_DIR = os.path.dirname(os.path.abspath(__file__))
UPDATE_LOG = "/var/log/mealprep-update.log"
NGINX_SITE = "/etc/nginx/sites-available/mealprep"


def _read(path, limit=None):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read() if limit is None else f.read()[-limit:]
    except OSError as e:
        return None


def _disk_commit():
    """Commit checked out in the app folder, read from .git directly (www-data can't run git in root's clone)."""
    head = (_read(os.path.join(APP_DIR, ".git", "HEAD")) or "").strip()
    if head.startswith("ref: "):
        ref = head[5:]
        c = (_read(os.path.join(APP_DIR, ".git", ref)) or "").strip()
        if not c:
            for line in (_read(os.path.join(APP_DIR, ".git", "packed-refs")) or "").splitlines():
                if line.endswith(" " + ref):
                    c = line.split(" ")[0]
        return c[:7] or None
    return head[:7] or None


STARTED_COMMIT = _disk_commit()
STARTED_AT = now()


@app.get("/api/server-status")
def server_status():
    site = _read(NGINX_SITE)
    log = _read(UPDATE_LOG, 6000)
    return jsonify({
        "version": APP_VERSION,
        "runningCommit": STARTED_COMMIT,
        "diskCommit": _disk_commit(),
        "startedAt": STARTED_AT,
        "nginxPopup": None if site is None else bool(re.search(r"^\s*auth_basic", site, re.M)),
        "passwordFile": os.path.exists(HTPASSWD),
        "signInOn": auth_on(),
        "updateLog": None if log is None else log.strip().splitlines()[-25:],
        "dataUpdates": updates_report(),
        "switchStatus": (_read(os.path.join(DATA_DIR, "nginx-switch-status")) or "").strip() or None,
    })


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "version": APP_VERSION})


# ---- data updates shipped through the repo (data-updates/*.json), applied once each when the app starts ----
# {"id": "...", "note": "...", "docs": {"meals/x": {"base": <version it was written against>, "data": {...}}}}
# {"delete": true} instead of "data" removes the doc (same "base" check; base 0 = add only if missing).
# {"add": {"items": {...}}} instead of "data" adds only the missing keys under that field (e.g. new ingredients in lib/ingredients), no base check.
# A doc is only replaced if it is still at "base" (nobody changed it in the app since); otherwise it is skipped and reported.
UPDATES_DIR = os.path.join(APP_DIR, "data-updates")


def apply_updates():
    if not os.path.isdir(UPDATES_DIR):
        return
    for fn in sorted(os.listdir(UPDATES_DIR)):
        if not fn.endswith(".json"):
            continue
        try:
            with open(os.path.join(UPDATES_DIR, fn), encoding="utf-8") as f:
                u = json.load(f)
            uid = str(u.get("id") or fn[:-5])
        except Exception as e:
            print("data update", fn, "unreadable:", e)
            continue
        with db() as c:
            if c.execute("SELECT 1 FROM kv WHERE k=?", ("update:" + uid,)).fetchone():
                continue
        backup = write_backup("before-update")
        done, skipped = [], []
        with _lock, db() as c:
            for path, spec in (u.get("docs") or {}).items():
                if not PATH_RE.match(path) or ("data" not in spec and not spec.get("delete") and not isinstance(spec.get("add"), dict)):
                    skipped.append({"path": path, "why": "bad entry"})
                    continue
                row = c.execute("SELECT version, data FROM docs WHERE path=?", (path,)).fetchone()
                cur = row["version"] if row else 0
                if "data" not in spec and isinstance(spec.get("add"), dict):
                    # add-only merge, no base check: {"add": {"items": {"id": {...}}}} adds keys that are missing, never overwrites
                    data = json.loads(row["data"]) if row else {}
                    added = []
                    for top, sub in spec["add"].items():
                        if not isinstance(sub, dict):
                            continue
                        tgt = data.setdefault(top, {})
                        if not isinstance(tgt, dict):
                            continue
                        for k, v in sub.items():
                            if k not in tgt:
                                tgt[k] = v
                                added.append(k)
                    if added:
                        c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES(?,?,?,?,?) "
                                  "ON CONFLICT(path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                                  (path, json.dumps(data, ensure_ascii=False), cur + 1, now(), "update:" + uid[:40]))
                        done.append(f"{path} (+{len(added)}: {', '.join(added)})")
                    else:
                        skipped.append({"path": path, "why": "nothing to add, all keys already there"})
                    continue
                if spec.get("base") is not None and spec["base"] != cur:
                    skipped.append({"path": path, "why": f"changed in the app since (now v{cur}, update written for v{spec['base']})"})
                    continue
                if spec.get("delete"):
                    if row:
                        c.execute("DELETE FROM docs WHERE path=?", (path,))
                        done.append(path + " (removed)")
                    continue
                c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES(?,?,?,?,?) "
                          "ON CONFLICT(path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                          (path, json.dumps(spec["data"], ensure_ascii=False), cur + 1, now(), "update:" + uid[:40]))
                done.append(path)
            c.execute("INSERT INTO kv VALUES(?,?)", ("update:" + uid, json.dumps(
                {"id": uid, "note": u.get("note", ""), "at": now(), "applied": done, "skipped": skipped, "backup": backup}, ensure_ascii=False)))
        print(f"data update {uid}: {len(done)} applied, {len(skipped)} skipped")


def updates_report():
    with db() as c:
        rows = [json.loads(r["v"]) for r in c.execute("SELECT v FROM kv WHERE k LIKE 'update:%'")]
    return sorted(rows, key=lambda r: r.get("at", ""), reverse=True)[:10]


# ---- shop prices: pinned products (docs products/<id>) checked against Rohlík and Košík. No model, just their public product data.
# Tesco blocks server requests, so its prices come from a bookmark run in Kyle's own Tesco tab (see static/prices.js).
import urllib.request, urllib.parse, urllib.error
UA = "Mozilla/5.0 (X11; Linux x86_64) MealPrepPlanner/1.0 (personal price check, a few requests a week)"
_pc = {"running": False, "done": 0, "total": 0, "started": None, "error": None}


def _get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json", "Accept-Language": "cs-CZ"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def product_ref(url):
    """(shop, product number) from a shop link, or (None, None)."""
    u = (url or "").strip()
    m = re.search(r"productPopup=(\d{6,8})", u) or re.search(r"rohlik\.cz/(?:[^?#]*?/)?(\d{6,8})(?:[-?#/]|$)", u)
    if "rohlik.cz" in u and m:
        return "rohlik", m.group(1)
    m = re.search(r"kosik\.cz/p(\d+)", u)
    if m:
        return "kosik", m.group(1)
    m = re.search(r"itesco\.cz/.*?/products/(\d+)", u)
    if m:
        return "tesco", m.group(1)
    return None, None


def _pack_from_text(txt):
    """'cca 500 g' -> 500, '1 l' -> 1000, '10 ks' -> 10"""
    m = re.search(r"([\d.,]+)\s*(kg|g|ml|l|ks)\b", txt or "", re.I)
    if not m:
        return None
    v = float(m.group(1).replace(",", ".")); u = m.group(2).lower()
    return round(v * 1000) if u in ("kg", "l") else round(v)


def rohlik_check(ids):
    out = {}
    for i in range(0, len(ids), 40):
        chunk = ids[i:i + 40]
        q = ",".join(chunk)
        prices = {str(x["productId"]): x for x in _get_json("https://www.rohlik.cz/api/v1/products/prices?products=" + q)}
        stock = {str(x["productId"]): x for x in _get_json("https://www.rohlik.cz/api/v1/products/stock?products=" + q)}
        for pid in chunk:
            p, s = prices.get(pid), stock.get(pid) or {}
            if not p:
                out[pid] = {"gone": True}
                continue
            r = {"price": p["price"]["amount"], "perUnit": (p.get("pricePerUnit") or {}).get("amount"),
                 "inStock": s.get("inStock"), "why": s.get("unavailabilityReason")}
            pk = s.get("packageInfo") or {}
            if pk.get("amount"):
                r["pack"] = round(pk["amount"] * 1000) if pk.get("unit") in ("kg", "l") else pk["amount"]
                r["packUnit"] = pk.get("unit")
            for sale in p.get("sales") or []:
                if not sale.get("active", True):
                    continue
                d = {"price": sale["price"]["amount"], "member": sale.get("type") == "premium",
                     "minQty": sale.get("triggerAmount") if (sale.get("triggerAmount") or 1) > 1 else None,
                     "until": (sale.get("validTill") or "")[:10] or None,
                     "text": ((sale.get("badges") or [{}])[0].get("title") or "")}
                if d["member"]:
                    r["memberPrice"] = d["price"]
                elif not r.get("sale") or d["price"] < r["sale"]["price"]:
                    r["sale"] = d
            out[pid] = r
        time.sleep(0.5)
    return out


def kosik_link(url, pid):
    """The pasted Košík link without tracking bits, keeping the name slug (kosik.cz/p<id> on its own is a 404)."""
    m = re.search(r"kosik\.cz/(p%s(?:-[^/?#\s]*)?)" % re.escape(pid), url or "")
    return "https://www.kosik.cz/" + (m.group(1) if m else "p" + pid)


def kosik_one(pid):
    try:
        p = _get_json("https://www.kosik.cz/api/front/product/" + pid).get("product") or {}
    except urllib.error.HTTPError as e:
        return {"gone": True} if e.code == 404 else {"error": f"HTTP {e.code}"}
    if not p.get("id"):
        return {"gone": True}
    r = {"price": p.get("price"), "perUnit": (p.get("pricePerUnit") or {}).get("price"), "unitBase": p.get("price"), "name": p.get("name"),
         "inStock": True if (p.get("maxInCart") or 0) > 0 else None}  # Košík hides stock for some fresh items without a delivery address
    if str(p.get("url") or "").startswith("/p"):
        r["url"] = "https://www.kosik.cz" + p["url"]  # the full link with the name slug; kosik.cz/p<id> alone is a 404
    reg = p.get("recommendedPrice")
    if p.get("isSale") or (reg and p.get("price") and p["price"] < reg - 0.01):
        r["sale"] = {"price": p["price"], "text": f"−{p.get('percentageDiscount')} %" if p.get("percentageDiscount") else "sale", "minQty": None}
        r["price"] = reg or p["price"]
    for c in p.get("cumulativePrices") or []:
        q, pr = c.get("quantity") or c.get("minQuantity"), c.get("price")
        if q and pr and pr < r["price"] and (not r.get("sale") or pr < r["sale"]["price"]):
            r["sale"] = {"price": pr, "text": f"{q}+ ks", "minQty": q}
    if p.get("loyaltyClubBenefitsPrice"):
        r["memberPrice"] = p["loyaltyClubBenefitsPrice"]
    pq = p.get("productQuantity") or {}
    if pq.get("value"):
        r["pack"] = _pack_from_text(f"{pq['value']} {pq.get('unit', '')}")
    return r


def run_price_check(ings):
    global _pc
    try:
        d = all_docs()
        prods = {p[9:]: v["data"] for p, v in d.items() if p.startswith("products/") and isinstance(v["data"], dict)}
        want = [(k, x) for k, x in prods.items() if not x.get("blocked") and x.get("status") != "rejected"
                and x.get("shop") in ("rohlik", "kosik") and (not ings or x.get("ing") in ings)]
        _pc.update(total=len(want), done=0)
        res = {}
        rids = {}
        for k, x in want:
            shop, pid = product_ref(x.get("url"))
            if shop == "rohlik":
                rids.setdefault(pid, []).append(k)
        if rids:
            try:
                rr = rohlik_check(list(rids))
            except Exception as e:
                rr = {pid: {"error": str(e)[:120]} for pid in rids}
            for pid, keys in rids.items():
                for k in keys:
                    res[k] = rr.get(pid, {"error": "no answer"})
            _pc["done"] += sum(len(v) for v in rids.values())
        seen = {}
        for k, x in want:
            shop, pid = product_ref(x.get("url"))
            if shop != "kosik":
                continue
            if pid not in seen:
                try:
                    seen[pid] = kosik_one(pid)
                except Exception as e:
                    seen[pid] = {"error": str(e)[:120]}
                time.sleep(0.4)
            res[k] = seen[pid]
            _pc["done"] += 1
        with _lock, db() as c:
            row = c.execute("SELECT data,version FROM docs WHERE path='state/prices'").fetchone()
            cur = json.loads(row["data"]) if row else {}
            items = cur.get("items") or {}
            stamp = now()
            for k, r in res.items():
                r["at"] = stamp
                items[k] = r
            cur.update(items=items, checkedAt=stamp)
            nv = (row["version"] if row else 0) + 1
            c.execute("INSERT INTO docs(path,data,version,updated_at,updated_by) VALUES('state/prices',?,?,?,?) "
                      "ON CONFLICT(path) DO UPDATE SET data=excluded.data,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
                      (json.dumps(cur, ensure_ascii=False), nv, stamp, "price-check"))
        _pc["error"] = None
    except Exception as e:
        _pc["error"] = str(e)[:200]
    finally:
        _pc["running"] = False


@app.post("/api/prices/check")
def api_price_check():
    body = request.get_json(force=True, silent=True) or {}
    with _lock:
        if _pc["running"]:
            return jsonify({"running": True, **_pc})
        _pc.update(running=True, done=0, total=0, started=now(), error=None)
    ings = set(body.get("ings") or [])
    threading.Thread(target=run_price_check, args=(ings,), daemon=True).start()
    return jsonify({"running": True})


@app.get("/api/prices/status")
def api_price_status():
    return jsonify(_pc)


@app.post("/api/products/lookup")
def api_product_lookup():
    """Name, pack size and price for a pasted shop link, so pinning a product is one paste."""
    url = (request.get_json(force=True, silent=True) or {}).get("url", "")
    shop, pid = product_ref(url)
    if not shop:
        return jsonify({"error": "That doesn't look like a Rohlík, Košík or Tesco product link."}), 400
    try:
        if shop == "rohlik":
            info = _get_json("https://www.rohlik.cz/api/v1/products?products=" + pid)
            info = info[0] if info else {}
            r = rohlik_check([pid]).get(pid, {})
            return jsonify({"shop": shop, "id": pid, "url": "https://www.rohlik.cz/" + pid, "name": info.get("name"),
                            "packG": r.get("pack") if r.get("packUnit") != "piece" else None,
                            "perKg": False, "price": r.get("price")})
        if shop == "kosik":
            r = kosik_one(pid)
            if r.get("gone"):
                return jsonify({"error": "Košík doesn't know that product (any more)."}), 404
            return jsonify({"shop": shop, "id": pid, "url": r.get("url") or kosik_link(url, pid), "name": r.get("name"),
                            "packG": r.get("pack"), "perKg": False, "price": r.get("price")})
    except Exception as e:
        return jsonify({"error": "Couldn't reach the shop: " + str(e)[:120]}), 502
    # Tesco: the server can't read it; the bookmark fills in name and price on the next Tesco check
    return jsonify({"shop": shop, "id": pid, "url": f"https://nakup.itesco.cz/groceries/cs-CZ/products/{pid}", "name": None, "packG": None, "perKg": False, "price": None})


@app.get("/api/products/search")
def api_product_search():
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify({"items": []})
    try:
        d = _get_json("https://www.rohlik.cz/services/frontend-service/search-metadata?offset=0&limit=12&companyId=1&search=" + urllib.parse.quote(q))
        items = []
        for x in (d.get("data") or {}).get("productList") or []:
            amt = x.get("textualAmount") or ""
            pcs = re.match(r"\s*(\d+)\s*ks\b", amt)
            # "1 ks" of something sold by weight: take the grams from the name, e.g. "Brokolice 1 ks (cca 500 g)"
            if pcs:
                gm = re.search(r"([\d.,]+)\s*(kg|g|ml|l)\b", x.get("productName") or "", re.I)
                grams = _pack_from_text(gm.group(0)) if gm else None
            else:
                grams = _pack_from_text(amt)
            items.append({"shop": "rohlik", "id": str(x["productId"]), "url": f"https://www.rohlik.cz/{x['productId']}", "name": x.get("productName"),
                          "amount": amt, "packG": grams * int(pcs.group(1)) if pcs and grams else grams, "packKs": int(pcs.group(1)) if pcs else None,
                          "perKg": False, "unit": x.get("unit"),
                          "price": (x.get("price") or {}).get("full"), "perUnit": (x.get("pricePerUnit") or {}).get("full")})
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": "Rohlík search failed: " + str(e)[:120]}), 502


init_db()
apply_updates()
if __name__ == "__main__":
    threading.Thread(target=backup_loop, daemon=True).start()
    from waitress import serve
    serve(app, host="127.0.0.1", port=PORT, threads=6)
