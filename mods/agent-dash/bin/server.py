#!/usr/bin/env python3
"""Serves Agent Dash in a browser: the web page, the mod's lib/ modules, and a small API over
herdr's agents and their transcripts (the same events the mod reads).

  python3 server.py [--port 4317]

Listens on 127.0.0.1 only. Every /api request needs the token written to ../.web/token, and
file contents are served only for files the agent's session changed. Exits after 30 minutes
without requests; the mod starts it again when needed.
"""

import base64
import hmac
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BIN = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BIN)

import me  # noqa: E402
import transcript  # noqa: E402
import tx_claude  # noqa: E402

MOD = os.path.dirname(BIN)
WEB = os.path.join(MOD, "web")
LIB = os.path.join(MOD, "lib")
STATE = os.path.join(MOD, ".web")
BUDGET = 1_500_000
IDLE_EXIT = 30 * 60
AGENTS_TTL = 3.0
BRANCH_TTL = 30.0
EDITORS = {"Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"}
TEXT_LIMIT = 2 * 1024 * 1024


def run(argv, timeout=8, cwd=None):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return r.returncode, r.stdout
    except (OSError, subprocess.SubprocessError):
        return 1, ""


def herdr_app():
    for candidate in (shutil.which("herdr-app"), os.path.expanduser("~/.local/bin/herdr-app"), "/Applications/Herdr.app/Contents/MacOS/Herdr"):
        if candidate and os.path.exists(candidate):
            return candidate
    return None


AGENT_PROGRAMS = re.compile(r"^(claude|codex|pi|gemini|opencode|amp|aider)$")
ENDED_SHOWN_MS = 24 * 3600 * 1000


def provider_of(app):
    app = (app or "").lower()
    return "claude" if "claude" in app else "codex" if "codex" in app else None


# Which version of this file is running: the mod restarts a server whose rev is not the file's.
SERVER_REV = int(os.path.getmtime(os.path.abspath(__file__)))
APP_HOME = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
LOGO_DIR = os.path.join(APP_HOME, "ray-sidebar", "logos")
LOGO_LIMIT = 512 * 1024
MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml"}


def me_avatar():
    """The picture of whoever uses the mod (see me.py: a file in `.me/`, or the GitHub account this
    computer is signed in with, fetched once) as a data URI, or None."""
    try:
        full = me.ensure()
    except (OSError, ValueError):
        full = None
    if full and os.path.isfile(full) and os.path.getsize(full) <= LOGO_LIMIT:
        ext = os.path.splitext(full)[1].lower()
        if ext in MIME:
            with open(full, "rb") as fh:
                return f"data:{MIME[ext]};base64,{base64.b64encode(fh.read()).decode()}"
    return None


def read_spaces():
    """Spaces the mod wrote (.web/spaces.json), a picked logo image inlined as a data URI.
    Only files inside the app's logo folder are read."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".web", "spaces.json"), encoding="utf-8") as fh:
            items = json.load(fh)
    except (OSError, ValueError):
        return []
    out = []
    for item in items if isinstance(items, list) else []:
        logo = item.get("logo") if isinstance(item, dict) else None
        entry = {"id": item.get("id"), "name": item.get("name"), "color": item.get("color"), "text": None, "image": None}
        if isinstance(logo, dict):
            entry["text"] = logo.get("text") or logo.get("emoji")
            rel = logo.get("image")
            if isinstance(rel, str):
                full = os.path.realpath(os.path.join(APP_HOME, rel))
                ext = os.path.splitext(full)[1].lower()
                if full.startswith(os.path.realpath(LOGO_DIR) + os.sep) and ext in MIME and os.path.isfile(full) and os.path.getsize(full) <= LOGO_LIMIT:
                    with open(full, "rb") as fh:
                        entry["image"] = f"data:{MIME[ext]};base64,{base64.b64encode(fh.read()).decode()}"
        out.append(entry)
    return out


class Agents:
    """herdr's agents (names from the window, process facts from herdr-core), cached briefly."""

    def __init__(self):
        self.lock = threading.Lock()
        self.at = 0.0
        self.value = []
        self.branches = {}
        self.finished = {}

    def branch(self, cwd):
        if not cwd:
            return None
        at, value = self.branches.get(cwd, (0.0, None))
        if time.time() - at > BRANCH_TTL:
            code, out = run(["git", "--no-optional-locks", "branch", "--show-current"], timeout=3, cwd=cwd) if os.path.isdir(cwd) else (1, "")
            value = out.strip() if code == 0 and out.strip() else None
            self.branches[cwd] = (time.time(), value)
        return value

    def get(self):
        with self.lock:
            if time.time() - self.at > AGENTS_TTL:
                self.value = self.load()
                self.at = time.time()
            return self.value

    def find(self, address):
        return next((a for a in self.get() if a["address"] == address), None)

    def places(self):
        exe = herdr_app()
        code, out = run([exe, "ls"]) if exe else (1, "")
        places, order = {}, []
        if code != 0:
            return places, order
        try:
            spaces = json.loads(out).get("spaces", [])
        except ValueError:
            return places, order
        for space in spaces:
            for tab in space.get("tabs", []):
                for term in tab.get("terminals", []):
                    address = term.get("terminal")
                    if not address:
                        continue
                    places[address] = {"space": space.get("name"), "tab": tab.get("name"), "pane": term.get("pane"),
                                       "machine": space.get("machine"), "status": term.get("status")}
                    order.append(address)
        return places, order

    def detail(self, address, finished):
        """`hc get`; a finished terminal never changes, so it is asked once."""
        if finished and address in self.finished:
            return self.finished[address]
        code, out = run(["hc", "get", address, "--json"], timeout=4)
        try:
            full = json.loads(out) if code == 0 else {}
        except ValueError:
            full = {}
        if finished and full:
            self.finished[address] = full
        return full

    def load(self):
        """Agents, and the terminals they started with `hc run` (sub-agents: `parent` is set;
        those stay listed for a day after they finish)."""
        places, order = self.places()
        code, out = run(["hc", "ls", "--all", "--json"])
        try:
            listed = json.loads(out).get("terminals", []) if code == 0 else []
        except ValueError:
            listed = []
        now = time.time() * 1000
        agents = []
        for t in listed:
            address = t["address"]
            finished = t.get("state") == "finished"
            if finished and not t.get("parent"):
                continue
            if not t.get("agent") and not t.get("parent"):
                continue
            full = self.detail(address, finished)
            if finished and now - (full.get("finished_ms") or 0) > ENDED_SHOWN_MS:
                continue
            report = full.get("status") if isinstance(full.get("status"), dict) else {}
            argv = full.get("argv") or []
            program = os.path.basename(argv[0]) if argv else (t.get("agent") or "")
            app = report.get("app") or (program if AGENT_PROGRAMS.match(program) else None)
            parent = full.get("parent") or t.get("parent")
            if not app and not parent:
                continue  # a shell or a plain program in a pane
            fg = full.get("foreground") or {}
            where = (full.get("labels") or {}).get("where") or t.get("where") or ""
            space, _, tab = where.partition(" / ")
            place = places.get(address, {})
            sub = bool(parent) and address not in places
            word = place.get("status") or t.get("status") or report.get("state")
            if sub:
                word = "ended" if finished else {"error": "blocked", "done": "idle"}.get(word, word) if word else "running"
            task = argv[-1] if app and len(argv) > 1 and not argv[-1].startswith("-") and len(argv[-1]) > 12 and " " in argv[-1] else None
            cwd = fg.get("cwd") or full.get("cwd") or t.get("cwd")
            agents.append({
                "address": address,
                "title": full.get("title") or "",
                "app": app,
                "provider": provider_of(app),
                "status": word,
                "space": place.get("space") or space,
                "tab": place.get("tab") or tab,
                "pane": place.get("pane"),
                "machine": place.get("machine"),
                "cwd": cwd,
                "branch": None if finished else self.branch(cwd),
                "pid": fg.get("pid") or (full.get("pid") if sub else None),
                "msg": report.get("msg"),
                "status_ms": full.get("status_ms"),
                "created_ms": full.get("created_ms"),
                "turn": full.get("turn"),
                "parent": parent,
                "sub": sub,
                "state": "ended" if finished else "live",
                "name": full.get("name") or full.get("template"),
                "program": program,
                "task": task,
                "command": " ".join(argv)[:2000],
                "finished_ms": full.get("finished_ms"),
                "exit_code": full.get("exit_code"),
                "reason": full.get("reason"),
            })
        known = {a["address"] for a in agents}
        self.finished = {k: v for k, v in self.finished.items() if k in known}
        # A finished or plain terminal whose parent is gone has no place in the tree.
        agents = [a for a in agents if not a["sub"] or a["parent"] in known or (a["state"] == "live" and a["app"])]
        rank = {a: i for i, a in enumerate(order)}
        return sorted(agents, key=lambda a: rank.get(a["address"], 10_000))


class Sessions:
    """Which transcript each agent writes, and which files its session changed."""

    def __init__(self):
        self.lock = threading.Lock()
        self.files = {}
        self.edited = {}
        self.images = {}

    def track(self, address):
        def seen(event):
            if event.get("k") != "call":
                return
            value = event.get("input") or {}
            if event.get("name") in ("Read", "view_image"):
                path = value.get("file_path") or value.get("path")
                if path and os.path.splitext(path)[1].lower() in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
                    with self.lock:
                        self.images.setdefault(address, set()).add(path)
                return
            if event.get("name") not in EDITORS:
                return
            paths = [value.get("file_path"), value.get("notebook_path"), *((value.get("changes") or {}).keys())]
            with self.lock:
                bucket = self.edited.setdefault(address, set())
                bucket.update(p for p in paths if p)
        return seen

    def allowed(self, address, path):
        with self.lock:
            if path in self.edited.get(address, set()):
                return True
            file = self.files.get(address)
        # Not seen yet (the server restarted mid-session): look for an edit of it in the transcript.
        if not file or not os.path.exists(file):
            return False
        needle = json.dumps(path, ensure_ascii=False)[1:-1].encode("utf-8")
        with open(file, "rb") as fh:
            for raw in fh:
                if needle in raw and (b'"name":"Edit"' in raw or b'"name":"Write"' in raw or b'"name":"MultiEdit"' in raw or b'FileChange' in raw):
                    with self.lock:
                        self.edited.setdefault(address, set()).add(path)
                    return True
        return False


AGENTS = Agents()
SESSIONS = Sessions()
LAST_REQUEST = [time.time()]


class Handler(BaseHTTPRequestHandler):
    server_version = "AgentDash/1"

    def log_message(self, *_args):
        pass

    def reply(self, code, body, kind="application/json; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def json(self, value, code=200):
        self.reply(code, json.dumps(value, ensure_ascii=False))

    def host_ok(self):
        port = self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def token_ok(self):
        return hmac.compare_digest(self.headers.get("X-Agent-Dash-Token", ""), self.server.token)

    def do_GET(self):  # noqa: N802 (http.server's naming)
        if not self.host_ok():
            return self.reply(403, "forbidden", "text/plain")
        url = urlparse(self.path)
        if url.path == "/health":
            return self.json({"ok": True, "app": "agent-dash", "rev": SERVER_REV})
        if url.path in ("/", "/index.html"):
            return self.static(os.path.join(WEB, "index.html"), "text/html; charset=utf-8")
        m = re.fullmatch(r"/lib/([a-z0-9_-]+\.js)", url.path)
        if m:
            return self.static(os.path.join(LIB, m.group(1)), "text/javascript; charset=utf-8")
        if not url.path.startswith("/api/"):
            return self.reply(404, "not found", "text/plain")
        if not self.token_ok():
            return self.json({"error": "token"}, 401)
        LAST_REQUEST[0] = time.time()
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            return self.api(url.path, q)
        except (OSError, ValueError, KeyError) as error:
            return self.json({"error": str(error)}, 500)

    def static(self, path, kind):
        if not os.path.isfile(path):
            return self.reply(404, "not found", "text/plain")
        with open(path, "rb") as fh:
            self.reply(200, fh.read(), kind)

    def api(self, path, q):
        if path == "/api/focus-state":
            exe = herdr_app()
            code, out = run([exe, "status"], timeout=3) if exe else (1, "")
            try:
                agent = json.loads(out).get("agent") if code == 0 else None
            except ValueError:
                agent = None
            return self.json({"agent": agent})
        if path == "/api/me":
            return self.json({"avatar": me_avatar()})
        if path == "/api/spaces":
            return self.json({"spaces": read_spaces()})
        if path == "/api/agents":
            return self.json({"agents": AGENTS.get(), "now": int(time.time() * 1000), "home": os.path.expanduser("~")})
        agent = AGENTS.find(q.get("agent", ""))
        if not agent:
            return self.json({"error": "no such agent"}, 404)
        if path == "/api/session":
            return self.session(agent, q)
        if path == "/api/focus":
            exe = herdr_app()
            code, _ = run([exe, "do", "agent.focus", "--terminal", agent["address"]]) if exe else (1, "")
            return self.json({"ok": code == 0}, 200 if code == 0 else 500)
        if path == "/api/image":
            return self.image(agent, q.get("path", ""))
        if path == "/api/prompt-image":
            return self.prompt_image(agent, q.get("at", ""), q.get("i", ""))
        target = q.get("path", "")
        if not target or not SESSIONS.allowed(agent["address"], target):
            return self.json({"error": "not a file this session changed"}, 403)
        if path == "/api/original":
            file = SESSIONS.files.get(agent["address"])
            if not file:
                return self.json({"found": False})
            with open(file, "rb") as fh:
                return self.json(tx_claude.original(fh, target, transcript.history_dir(file)))
        if path == "/api/current":
            if not os.path.isfile(target):
                return self.json({"missing": True})
            if os.path.getsize(target) > TEXT_LIMIT:
                return self.json({"tooLarge": True})
            with open(target, encoding="utf-8", errors="replace") as fh:
                return self.json({"text": fh.read()})
        if path == "/api/head":
            return self.json(self.head(agent, target))
        return self.json({"error": "unknown"}, 404)

    def session(self, agent, q):
        if agent["address"].count("/") or not agent.get("provider"):
            return self.reply(200, '{"k":"missing"}\n{"k":"end","offset":0,"size":0,"more":false}\n', "application/x-ndjson")
        if not agent.get("pid"):
            return self.reply(200, '{"k":"missing"}\n{"k":"end","offset":0,"size":0,"more":false}\n', "application/x-ndjson")
        out = io.StringIO()
        # A sub-agent is matched by when it started and what it was asked (see transcript.py).
        hints = None
        if agent.get("sub") and agent.get("created_ms"):
            hints = {"since": agent["created_ms"], "until": agent.get("finished_ms"), "dead": agent.get("state") == "ended", "task": (agent.get("task") or "")[:200] or None}
        found = transcript.sync(agent["provider"], int(agent["pid"]), agent.get("cwd") or "", q.get("file", "-"), int(q.get("offset", "0") or 0),
                                BUDGET, out, SESSIONS.track(agent["address"]), hints)
        if found:
            with SESSIONS.lock:
                SESSIONS.files[agent["address"]] = found["path"]
        self.reply(200, out.getvalue(), "application/x-ndjson; charset=utf-8")

    def image(self, agent, target):
        kinds = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
        kind = kinds.get(os.path.splitext(target)[1].lower())
        if not kind or target not in SESSIONS.images.get(agent["address"], set()) or not os.path.isfile(target):
            return self.reply(404, "not found", "text/plain")
        if os.path.getsize(target) > 15 * 1024 * 1024:
            return self.reply(413, "too large", "text/plain")
        with open(target, "rb") as fh:
            return self.reply(200, fh.read(), kind)

    def prompt_image(self, agent, at, index):
        """A picture the person attached to a prompt of this session (from its transcript)."""
        file = SESSIONS.files.get(agent["address"])
        if not file or not at.isdigit() or not index.isdigit():
            return self.reply(404, "not found", "text/plain")
        try:
            found = transcript.prompt_image(file, int(at), int(index))
        except (OSError, ValueError):
            found = None
        if not found:
            return self.reply(404, "not found", "text/plain")
        return self.reply(200, found[1], found[0])

    def head(self, agent, target):
        cwd = agent.get("cwd") or os.path.dirname(target)
        code, top = run(["git", "rev-parse", "--show-toplevel"], cwd=cwd)
        if code != 0:
            return {"found": False}
        root = top.strip()
        rel = target[len(root) + 1:] if target.startswith(root + "/") else target
        code, text = run(["git", "--no-optional-locks", "show", f"HEAD:{rel}"], cwd=root)
        return {"found": code == 0, "text": text if code == 0 else ""}


def listen(start):
    for port in range(start, start + 20):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), Handler)
        except OSError:
            continue
    raise SystemExit("no free port")


def write_state(server):
    os.makedirs(STATE, exist_ok=True)
    for name, value in (("token", server.token), ("port", str(server.server_address[1]))):
        path = os.path.join(STATE, name)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(value)


def watch_idle(server):
    while True:
        time.sleep(30)
        if time.time() - LAST_REQUEST[0] > IDLE_EXIT:
            server.shutdown()
            return


def main(argv):
    start = int(argv[argv.index("--port") + 1]) if "--port" in argv else 4317
    server = listen(start)
    server.daemon_threads = True
    server.token = secrets.token_hex(16)
    write_state(server)
    threading.Thread(target=watch_idle, args=(server,), daemon=True).start()
    sys.stdout.write(f"agent-dash web: http://127.0.0.1:{server.server_address[1]}/\n")
    sys.stdout.flush()
    try:
        server.serve_forever()
    finally:
        # Only our own port file: a newer copy started meanwhile has already written its own.
        try:
            path = os.path.join(STATE, "port")
            with open(path, encoding="utf-8") as fh:
                ours = fh.read().strip() == str(server.server_address[1])
            if ours:
                os.remove(path)
        except OSError:
            pass


if __name__ == "__main__":
    main(sys.argv)
