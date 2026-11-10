"""Claude Code transcript lines (~/.claude/projects/<dir>/<session>.jsonl) -> compact events."""

import json
import re

from tx_common import cap, count_images, drop_none, head_tail, small, strip_base64, text_of, to_ms, trim

# Bookkeeping lines start with their type; everything said in the session starts with parentUuid.
TITLE_TYPES = {"ai-title": "aiTitle", "custom-title": "customTitle", "agent-name": "agentName", "summary": "summary"}
REMINDER = re.compile(r"<system-reminder>[\s\S]*?</system-reminder>")
COMMAND_NAME = re.compile(r"<command-name>([\s\S]*?)</command-name>")
COMMAND_ARGS = re.compile(r"<command-args>([\s\S]*?)</command-args>")
NOT_PROMPTS = ("<local-command-stdout>", "<local-command-stderr>", "<bash-stdout>", "<bash-stderr>", "Caveat:")
INTERRUPTED = "[Request interrupted by user"

# Results the Jira / Notion / Slack views parse whole (a search, a page, a thread).
WHOLE_JSON = ('{"issues"', '{"metadata"', '{"results"', '{"messages"', '{"pages"')
RESULT_LIMIT = 64000
DOCS_LIMIT = 400000
FILE_LIMIT = 200000


def consume(raw):
    """One transcript line (bytes, newline included) -> list of events."""
    if raw.startswith(b'{"type":"'):
        end = raw.find(b'"', 9)
        kind = raw[9:end].decode("utf-8", "replace")
        if kind not in TITLE_TYPES:
            return []
        obj = json.loads(raw)
        title = obj.get(TITLE_TYPES[kind])
        return [{"k": "title", "kind": kind, "text": title}] if isinstance(title, str) else []
    obj = json.loads(strip_base64(raw))
    kind = obj.get("type")
    if kind == "assistant":
        return assistant(obj)
    if kind == "user":
        return user(obj)
    if kind == "system":
        return system(obj)
    return []


def assistant(obj):
    msg = obj.get("message") or {}
    ts = to_ms(obj.get("timestamp"))
    side = bool(obj.get("isSidechain"))
    model = msg.get("model")
    events = []
    usage = msg.get("usage")
    if msg.get("id") and isinstance(usage, dict):
        events.append(drop_none({
            "k": "usage", "id": msg["id"], "side": side or None,
            "model": model if model and not model.startswith("<") else None,
            "in": usage.get("input_tokens", 0), "out": usage.get("output_tokens", 0),
            "cr": usage.get("cache_read_input_tokens", 0), "cw": usage.get("cache_creation_input_tokens", 0),
        }))
    for block in msg.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and not side and str(block.get("text", "")).strip():
            events.append({"k": "reply", "id": obj.get("uuid"), "mid": msg.get("id"), "ts": ts, "text": cap(block["text"], RESULT_LIMIT)})
        elif block.get("type") == "tool_use":
            events.append(drop_none({
                "k": "call", "id": block.get("id"), "ts": ts, "name": block.get("name"),
                "input": slim_input(block.get("name"), block.get("input") or {}), "side": side or None,
            }))
    return events


def slim_input(name, value):
    if name == "Write" and isinstance(value, dict):
        return {**trim({k: v for k, v in value.items() if k != "content"}), "content": cap(value.get("content", ""), FILE_LIMIT)}
    return trim(value, RESULT_LIMIT)


def user(obj):
    msg = obj.get("message") or {}
    content = msg.get("content")
    ts = to_ms(obj.get("timestamp"))
    if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        extra = obj.get("toolUseResult")
        return [result(b, extra, ts) for b in content if isinstance(b, dict) and b.get("type") == "tool_result"]
    if obj.get("isMeta") or obj.get("isSidechain") or obj.get("isCompactSummary"):
        return []
    text = text_of(content).strip()
    images = count_images(content)
    if text.startswith(INTERRUPTED):
        return [{"k": "interrupt", "ts": ts}]
    if not text and not images:
        return []
    if text.startswith(NOT_PROMPTS):
        return []
    command = COMMAND_NAME.search(text)
    if command:
        args = COMMAND_ARGS.search(text)
        text = command.group(1).strip() + (" " + args.group(1).strip() if args and args.group(1).strip() else "")
    text = REMINDER.sub("", text).strip()
    if not text and not images:
        return []
    return [drop_none({"k": "prompt", "id": obj.get("uuid"), "ts": ts, "text": cap(text, 32000), "images": images or None, "command": bool(command) or None})]


def result(block, extra, ts):
    content = block.get("content")
    text = text_of(content)
    slim = slim_extra(extra)
    # Structured results already carry the text; don't send it twice.
    if slim and ("stdout" in slim or "file" in slim or "result" in slim):
        text = ""
    # Documents and JSON (database rows, a Jira search, a Notion page) are parsed whole by the views:
    # a cut one can't be read, so they get the larger limit.
    limit = DOCS_LIMIT if "<untrusted-user-data" in text or text.startswith(WHOLE_JSON) else RESULT_LIMIT
    if isinstance(extra, str) and not text:
        text = extra
    return drop_none({
        "k": "result", "id": block.get("tool_use_id"), "ts": ts,
        "err": bool(block.get("is_error")) or None, "text": cap(text, limit),
        "images": count_images(content) or None, "extra": slim,
    })


def slim_extra(x):
    """Keeps what the views draw from a toolUseResult; the shape tells which tool made it."""
    if not isinstance(x, dict):
        return None
    if "stdout" in x or "stderr" in x:
        return drop_none({
            "stdout": head_tail(x.get("stdout") or "", 48000), "stderr": head_tail(x.get("stderr") or "", 16000),
            "interrupted": x.get("interrupted") or None, "bg": x.get("backgroundTaskId"),
            "noOutput": x.get("noOutputExpected") or None, "rc": x.get("returnCodeInterpretation"), "image": x.get("isImage") or None,
        })
    if "structuredPatch" in x:
        return drop_none({
            "type": x.get("type"), "filePath": x.get("filePath"), "patch": trim(x.get("structuredPatch"), 20000, 400),
            "userModified": x.get("userModified") or None, "replaceAll": x.get("replaceAll") or None,
        })
    if isinstance(x.get("file"), dict):
        f = x["file"]
        if x.get("type") == "image" or "base64" in f:
            return drop_none({"type": "image", "media": f.get("type"), "size": f.get("originalSize"), "dims": f.get("dimensions")})
        return {"type": x.get("type") or "text", "file": drop_none({
            "filePath": f.get("filePath"), "content": cap(f.get("content") or "", FILE_LIMIT),
            "numLines": f.get("numLines"), "startLine": f.get("startLine"), "totalLines": f.get("totalLines"),
        })}
    if "filenames" in x:
        return drop_none({
            "mode": x.get("mode"), "numFiles": x.get("numFiles"), "filenames": (x.get("filenames") or [])[:1000],
            "content": cap(x.get("content") or "", RESULT_LIMIT), "numLines": x.get("numLines"),
            "truncated": x.get("truncated") or None, "ms": x.get("durationMs"),
        })
    if "code" in x and "bytes" in x:
        return drop_none({
            "code": x.get("code"), "codeText": x.get("codeText"), "bytes": x.get("bytes"), "url": x.get("url"),
            "ms": x.get("durationMs"), "result": cap(x.get("result") or "", RESULT_LIMIT),
        })
    if "agentId" in x:
        keep = ("agentId", "status", "description", "resolvedModel", "isAsync", "totalDurationMs", "totalTokens", "totalToolUseCount")
        slim = {k: x.get(k) for k in keep}
        slim["prompt"] = cap(x.get("prompt") or "", 16000)
        slim["content"] = cap(text_of(x.get("content")), RESULT_LIMIT)
        return drop_none(slim)
    if "newTodos" in x or "oldTodos" in x:
        return {"old": x.get("oldTodos") or [], "new": x.get("newTodos") or []}
    if "answers" in x:
        return drop_none({"answers": x.get("answers"), "annotations": x.get("annotations")})
    if x.get("type") == "create" and "content" in x:
        return {"type": "create", "filePath": x.get("filePath")}
    if "results" in x and "query" in x:
        return drop_none({"query": x.get("query"), "results": trim(x.get("results"), 4000, 50), "s": x.get("durationSeconds")})
    return small(trim(x, 4000, 100))


def system(obj):
    ts = to_ms(obj.get("timestamp"))
    sub = obj.get("subtype")
    if sub == "turn_duration":
        return [{"k": "turn", "ts": ts, "dur": obj.get("durationMs")}]
    if sub == "compact_boundary":
        return [{"k": "compact", "ts": ts}]
    return []


def original(raw_lines, path, history_dir=None):
    """The file text before the session first changed `path`.

    The first Edit/Write result usually keeps it as originalFile; when that is null (some Write
    overwrites), Claude Code's own rewind backups (file-history/<session>/<name>@vN) hold it.
    """
    needle = json.dumps(path, ensure_ascii=False)[1:-1].encode("utf-8")
    name = path.rsplit("/", 1)[-1].encode("utf-8")
    first = None
    backup = None
    for raw in raw_lines:
        if raw.startswith(b'{"type":"file-history-'):
            if name in raw:
                backup = earliest_backup(raw, path, backup)
            continue
        if first is not None or needle not in raw or b'"toolUseResult"' not in raw:
            continue
        try:
            obj = json.loads(strip_base64(raw))
        except ValueError:
            continue
        extra = obj.get("toolUseResult")
        if isinstance(extra, dict) and extra.get("filePath") == path:
            first = {"ts": to_ms(obj.get("timestamp")), "type": extra.get("type"), "text": extra.get("originalFile")}
    if first and first["type"] == "create":
        return {"found": True, "created": True, "text": "", "ts": first["ts"], "source": "transcript"}
    if first and isinstance(first["text"], str):
        return {"found": True, "created": False, "text": first["text"], "ts": first["ts"], "source": "transcript"}
    if backup and history_dir:
        if backup["file"] is None:
            return {"found": True, "created": True, "text": "", "source": "file-history"}
        try:
            with open(f"{history_dir}/{backup['file']}", encoding="utf-8", errors="replace") as fh:
                return {"found": True, "created": False, "text": fh.read(), "source": "file-history"}
        except OSError:
            pass
    return {"found": False}


def earliest_backup(raw, path, best):
    """The lowest-version backup of `path` named in a file-history line ({file, version})."""
    try:
        obj = json.loads(raw)
    except ValueError:
        return best
    entries = []
    if obj.get("type") == "file-history-delta":
        entries.append((obj.get("trackingPath"), obj.get("backup") or {}))
    else:
        for tracked, b in ((obj.get("snapshot") or {}).get("trackedFileBackups") or {}).items():
            entries.append((tracked, b or {}))
    for tracked, b in entries:
        parent = b.get("realParentDir")
        full = f"{parent}/{tracked.rsplit('/', 1)[-1]}" if parent else tracked
        if full != path and not path.endswith("/" + (tracked or "")):
            continue
        version = b.get("version") or 0
        if best is None or version < best["version"]:
            best = {"file": b.get("backupFileName"), "version": version}
    return best
