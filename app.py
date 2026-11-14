"""Meal Prep Planner: small Flask app. Stores everything as JSON documents in one SQLite file.

Logins are handled by nginx (basic auth, two users). nginx passes the user name in X-Remote-User.
The only page open without a login is the read-only Cook page behind a secret link (/cook/<token>).
"""
import json, os, secrets, sqlite3, subprocess, threading, time, datetime, re, shutil
from flask import Flask, request, jsonify, send_from_directory, abort, Response

APP_VERSION = "0.1.1"
DATA_DIR = os.environ.get("MEALPREP_DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "_data"))
PORT = int(os.environ.get("MEALPREP_PORT", "5020"))
HTPASSWD = os.environ.get("MEALPREP_HTPASSWD", "/etc/nginx/.mealprep-htpasswd")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
DB_PATH = os.path.join(DATA_DIR, "mealprep.db")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
BACKUP_KEEP = 14

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


def user():
    return request.headers.get("X-Remote-User") or os.environ.get("MEALPREP_DEV_USER", "dev")


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
    return jsonify({"ok": True})


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "version": APP_VERSION})


init_db()
if __name__ == "__main__":
    threading.Thread(target=backup_loop, daemon=True).start()
    from waitress import serve
    serve(app, host="127.0.0.1", port=PORT, threads=6)
