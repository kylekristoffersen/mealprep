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

APP_VERSION = "0.4.0"
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


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "version": APP_VERSION})


init_db()
if __name__ == "__main__":
    threading.Thread(target=backup_loop, daemon=True).start()
    from waitress import serve
    serve(app, host="127.0.0.1", port=PORT, threads=6)
