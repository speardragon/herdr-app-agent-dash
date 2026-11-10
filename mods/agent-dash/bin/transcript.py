#!/usr/bin/env python3
"""Reads a coding agent's transcript for the agent-dash mod (and any other viewer).

  transcript.py sync <claude|codex> <pid> <cwd> <known-file|-> <offset> [budget] [hints-json]
      Finds the transcript of the agent process <pid>, then prints events from <offset>.
      If the transcript is another file than <known-file>, starts it from 0 and says so.
      hints (for a sub-agent started with `hc run`): {"since": <start ms>, "until": <end ms>,
      "dead": true when the process is gone, "task": "<its launch task>"}.
  transcript.py read <claude|codex> <file> <offset> [budget]
  transcript.py original <file> <path>
      The text of <path> before the session first changed it.

Output is one JSON object per line. The last line is {"k":"end", "offset", "size", "more"}:
read again from `offset` while `more` is true. A missing end line means the output was cut.
Standard library only, so it runs wherever python3 does.
"""

import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import tx_claude  # noqa: E402
import tx_codex  # noqa: E402

DEFAULT_BUDGET = 5_000_000
PARSERS = {"claude": tx_claude.consume, "codex": tx_codex.consume}


def write(record, out=None):
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    (out or sys.stdout).write(line)
    return len(line.encode("utf-8"))


def read(provider, path, offset, budget, out=None, seen=None):
    """Writes events from `offset` to `out`; `seen(event)` lets a caller watch them (the web server
    learns which files a session touched, so it only serves those)."""
    consume = PARSERS[provider]
    size = os.path.getsize(path)
    reset = offset > size
    pos = 0 if reset else offset
    written = 0
    more = False
    with open(path, "rb") as fh:
        fh.seek(pos)
        while True:
            raw = fh.readline()
            # A line without its newline is still being written: leave it for the next read.
            if not raw or not raw.endswith(b"\n"):
                break
            pos += len(raw)
            try:
                events = consume(raw)
            except (ValueError, KeyError, TypeError, AttributeError):
                events = [{"k": "skip", "bytes": len(raw)}]
            for event in events:
                if seen:
                    seen(event)
                written += write(event, out)
            if written >= budget:
                more = pos < size
                break
    write({"k": "end", "offset": pos, "size": size, "more": more, "reset": reset or None}, out)


def claude_home():
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")


def encoded(cwd):
    return "".join(ch if ch.isalnum() else "-" for ch in cwd)


def born(path):
    st = os.stat(path)
    return getattr(st, "st_birthtime", None) or st.st_mtime


def head_has(path, task, size=65536):
    """Whether the transcript opens with `task` (a sub-agent's first message is its launch task)."""
    if not task:
        return False
    needle = json.dumps(task, ensure_ascii=False)[1:-1].encode("utf-8")
    plain = json.dumps(task)[1:-1].encode("utf-8")
    try:
        with open(path, "rb") as fh:
            head = fh.read(size)
    except OSError:
        return False
    return needle in head or plain in head


def by_start(files, hints):
    """The transcript a process started at hints["since"] wrote: one that opens with its task,
    else the first one born after it started (and before it ended)."""
    since = hints.get("since")
    if not since:
        return None
    lo = since / 1000 - 1
    hi = (hints.get("until") / 1000 + 5) if hints.get("until") else None
    near = sorted((born(f), f) for f in files if born(f) >= lo and (hi is None or born(f) <= hi))
    if not near:
        return None
    for _, path in near:
        if head_has(path, hints.get("task")):
            return path
    # Without a task to match, only trust a file born right as the process started.
    first_born, first = near[0]
    return first if first_born - since / 1000 < 180 else None


def locate_claude(pid, cwd, hints=None):
    hints = hints or {}
    home = claude_home()
    projects = os.path.join(home, "projects")
    session = None
    if not hints.get("dead"):
        try:
            with open(os.path.join(home, "sessions", f"{pid}.json"), encoding="utf-8") as fh:
                info = json.load(fh)
            session = info.get("sessionId")
            cwd = info.get("cwd") or cwd
        except (OSError, ValueError):
            session = None
    if session:
        guess = os.path.join(projects, encoded(cwd), f"{session}.jsonl")
        if os.path.exists(guess):
            return {"path": guess, "session": session}
        for found in glob.glob(os.path.join(projects, "*", f"{session}.jsonl")):
            return {"path": found, "session": session}
    files = glob.glob(os.path.join(projects, encoded(cwd), "*.jsonl"))
    if not files:
        return None
    if hints.get("since"):
        # A sub-agent often shares its folder with its parent: never fall back to "the newest".
        path = by_start(files, hints)
        return {"path": path, "session": os.path.basename(path)[:-6], "inferred": True} if path else None
    # No session record (an older Claude Code): the newest transcript in its folder.
    newest = max(files, key=os.path.getmtime)
    return {"path": newest, "session": os.path.basename(newest)[:-6], "inferred": True}


def process_start(pid):
    try:
        out = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], capture_output=True, text=True, timeout=3).stdout.strip()
        return time.mktime(time.strptime(out, "%a %b %d %H:%M:%S %Y")) if out else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def locate_codex(pid, cwd, hints=None):
    """Codex doesn't publish its session id: take the newest rollout written in the same folder
    since the process started (marked as inferred)."""
    root = os.path.join(os.environ.get("CODEX_HOME") or os.path.expanduser("~/.codex"), "sessions")
    target = os.path.realpath(cwd) if cwd else None
    now = time.time()
    days = {time.strftime("%Y/%m/%d", time.localtime(now - d * 86400)) for d in range(8)}
    candidates = []
    for day in days:
        for path in glob.glob(os.path.join(root, day, "*.jsonl")):
            meta_cwd, _ = tx_codex.meta_of(path)
            if target and meta_cwd and os.path.realpath(meta_cwd) == target:
                candidates.append((os.path.getmtime(path), path))
    if not candidates:
        return None
    if (hints or {}).get("since"):
        path = by_start([c[1] for c in candidates], hints)
        return {"path": path, "session": os.path.basename(path)[:-6][-36:], "inferred": True} if path else None
    started = process_start(pid)
    recent = [c for c in candidates if started is None or c[0] >= started - 5]
    _, path = max(recent or candidates)
    session = os.path.basename(path)[:-6]
    return {"path": path, "session": session[-36:], "inferred": True}


def locate(provider, pid, cwd, hints=None):
    return locate_claude(pid, cwd, hints) if provider == "claude" else locate_codex(pid, cwd, hints)


def sync(provider, pid, cwd, known, offset, budget, out=None, seen=None, hints=None):
    # A finished sub-agent's file doesn't change: keep the one already being read rather than guess again.
    if hints and hints.get("dead") and known and known != "-" and os.path.exists(known):
        found = {"path": known, "session": os.path.basename(known)[:-6], "inferred": True}
    else:
        found = locate(provider, pid, cwd, hints)
    if not found:
        write({"k": "missing"}, out)
        write({"k": "end", "offset": 0, "size": 0, "more": False}, out)
        return None
    if found["path"] != known:
        write({"k": "file", **found}, out)
        offset = 0
    read(provider, found["path"], offset, budget, out, seen)
    return found


def history_dir(transcript):
    session = os.path.basename(transcript)[:-6]
    return os.path.join(claude_home(), "file-history", session)


def original(path, target):
    with open(path, "rb") as fh:
        result = tx_claude.original(fh, target, history_dir(path))
    write(result)


def main(argv):
    try:
        command = argv[1]
        if command == "sync":
            hints = json.loads(argv[8]) if len(argv) > 8 else None
            sync(argv[2], int(argv[3]), argv[4], argv[5], int(argv[6]), int(argv[7]) if len(argv) > 7 else DEFAULT_BUDGET, hints=hints if isinstance(hints, dict) else None)
        elif command == "read":
            read(argv[2], argv[3], int(argv[4]), int(argv[5]) if len(argv) > 5 else DEFAULT_BUDGET)
        elif command == "original":
            original(argv[2], argv[3])
        else:
            raise IndexError(command)
    except (IndexError, KeyError, ValueError) as error:
        write({"k": "error", "message": f"usage: {error}"})
        return 2
    except OSError as error:
        write({"k": "error", "message": str(error)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
