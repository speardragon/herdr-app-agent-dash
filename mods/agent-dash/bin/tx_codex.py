"""Codex rollout lines (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) -> compact events.

Current Codex records what happened as `event_msg/item_completed` items (commands, file
changes, MCP calls, messages); the `exec` tool's JavaScript source is only a wrapper around
them. Older rollouts use function_call / custom_tool_call pairs, which are read as well.
"""

import json

from tx_common import cap, count_images, drop_none, head_tail, text_of, to_ms, trim

SKIP = (b'"type":"world_state"', b'"type":"token_usage_record"', b'"type":"thread_settings_applied"',
        b'"type":"reasoning"', b'"type":"additional_tools"')
RESULT_LIMIT = 64000
DOCS_LIMIT = 400000
SHELLS = ("bash", "zsh", "sh", "/bin/bash", "/bin/zsh", "/bin/sh", "/usr/bin/bash", "/usr/bin/zsh")


def consume(raw):
    head = raw[:160]
    if any(mark in head for mark in SKIP):
        return []
    obj = json.loads(raw)
    kind = obj.get("type")
    payload = obj.get("payload") or {}
    ts = to_ms(obj.get("timestamp"))
    if kind == "session_meta":
        return [drop_none({"k": "meta", "cwd": payload.get("cwd"), "session": payload.get("id"),
                           "version": payload.get("cli_version"), "started": to_ms(payload.get("timestamp"))})]
    if kind == "turn_context":
        return [{"k": "model", "model": payload.get("model")}] if payload.get("model") else []
    if kind == "event_msg":
        return event(payload, ts)
    if kind == "response_item":
        return item(payload, ts)
    return []


def event(p, ts):
    kind = p.get("type")
    if kind == "item_completed":
        return completed(p.get("item") or {}, p.get("started_at_ms") or ts, p.get("completed_at_ms") or ts, p.get("turn_id"))
    if kind == "task_started":
        return [drop_none({"k": "turnstart", "ts": ts, "turn": p.get("turn_id"), "win": p.get("model_context_window")})]
    if kind == "task_complete":
        return [drop_none({"k": "turn", "ts": ts, "dur": p.get("duration_ms"), "turn": p.get("turn_id")})]
    if kind == "turn_aborted":
        return [drop_none({"k": "interrupt", "ts": ts, "reason": p.get("reason")})]
    if kind == "token_count":
        return tokens(p.get("info") or {})
    if kind == "user_message":
        text = (p.get("message") or "").strip()
        return [{"k": "prompt", "id": f"um-{ts}", "ts": ts, "text": cap(text, 32000)}] if text else []
    if kind == "agent_message":
        text = (p.get("message") or "").strip()
        return [{"k": "reply", "id": f"am-{ts}", "ts": ts, "text": cap(text, RESULT_LIMIT)}] if text else []
    return []


def tokens(info):
    total = info.get("total_token_usage") or {}
    last = info.get("last_token_usage") or {}
    if not total:
        return []
    cached = total.get("cached_input_tokens", 0)
    # OpenAI counts cached tokens inside input_tokens.
    return [drop_none({
        "k": "total", "in": max(0, total.get("input_tokens", 0) - cached), "out": total.get("output_tokens", 0),
        "cr": cached, "cw": total.get("cache_write_input_tokens", 0), "rs": total.get("reasoning_output_tokens", 0),
        "ctx": last.get("input_tokens"), "win": info.get("model_context_window"),
    })]


def duration_ms(value):
    if isinstance(value, dict):
        return int(value.get("secs", 0) * 1000 + value.get("nanos", 0) / 1e6)
    if isinstance(value, (int, float)):
        return int(value)
    return None


def unwrap(command):
    """["/bin/zsh", "-lc", "npm test"] -> "npm test"."""
    if isinstance(command, list):
        if len(command) >= 3 and command[0] in SHELLS and command[1] in ("-lc", "-c"):
            return command[2]
        return " ".join(str(c) for c in command)
    return command


def path_of(url):
    return url[7:] if isinstance(url, str) and url.startswith("file://") else url


def call(cid, ts, name, value):
    return drop_none({"k": "call", "id": cid, "ts": ts, "name": name, "input": value})


def done(cid, ts, text="", err=None, extra=None, limit=RESULT_LIMIT):
    return drop_none({"k": "result", "id": cid, "ts": ts, "text": cap(text, limit), "err": err or None, "extra": extra})


def completed(it, start, end, turn):
    kind = it.get("type")
    cid = it.get("id")
    if kind == "UserMessage":
        text = text_of(it.get("content")).strip()
        images = count_images(it.get("content"))
        return [drop_none({"k": "prompt", "id": cid, "ts": start, "text": cap(text, 32000), "images": images or None, "turn": turn})] if text or images else []
    if kind == "AgentMessage":
        text = text_of(it.get("content")).strip()
        return [drop_none({"k": "reply", "id": cid, "ts": end, "text": cap(text, RESULT_LIMIT), "phase": it.get("phase")})] if text else []
    if kind == "CommandExecution":
        exit_code = it.get("exit_code")
        return [call(cid, start, "exec_command", drop_none({"command": unwrap(it.get("command")), "cwd": path_of(it.get("cwd")), "parsed": trim(it.get("parsed_cmd"), 2000, 20)})),
                done(cid, end, head_tail(it.get("aggregated_output") or "", RESULT_LIMIT), exit_code not in (0, None),
                     drop_none({"exit": exit_code, "ms": duration_ms(it.get("duration")), "status": it.get("status")}))]
    if kind == "FileChange":
        changes = {path: {"type": (c or {}).get("type"), "diff": cap((c or {}).get("unified_diff") or "", 200000)} for path, c in (it.get("changes") or {}).items()}
        return [call(cid, start, "apply_patch", {"changes": changes}),
                done(cid, end, it.get("stdout") or "", it.get("status") not in ("completed", None), drop_none({"stderr": cap(it.get("stderr") or "", 8000)}))]
    if kind == "McpToolCall":
        res = it.get("result") or {}
        text = text_of(res.get("content")) if isinstance(res, dict) else text_of(res)
        failed = it.get("status") not in ("completed", None) or (isinstance(res, dict) and res.get("isError"))
        limit = DOCS_LIMIT if "<untrusted-user-data" in text else RESULT_LIMIT
        return [call(cid, start, f"mcp__{it.get('server')}__{it.get('tool')}", trim(it.get("arguments") or {})),
                done(cid, end, text, failed, drop_none({"ms": duration_ms(it.get("duration"))}), limit)]
    if kind == "ImageView":
        return [call(cid, start, "view_image", {"path": path_of(it.get("path"))}), done(cid, end)]
    if kind == "Extension":
        return extension(it, cid, start, end)
    if kind == "Reasoning":
        return []
    return [call(cid, start, kind or "item", trim(it, 4000, 100)), done(cid, end)]


def extension(it, cid, start, end):
    ext = it.get("kind") or ""
    if ext == "web.search":
        results = [drop_none({"title": r.get("title"), "url": r.get("url"), "snippet": cap(r.get("snippet") or "", 600), "domain": r.get("domain")})
                   for r in (it.get("results") or []) if isinstance(r, dict)]
        return [call(cid, start, "web_search", drop_none({"query": it.get("query")})), done(cid, end, extra={"results": results[:30]})]
    if ext == "clock.sleep":
        return [call(cid, start, "sleep", {"durationMs": it.get("durationMs")}), done(cid, end)]
    return [call(cid, start, ext or "extension", trim({k: v for k, v in it.items() if k not in ("id", "type")}, 4000, 100)), done(cid, end)]


def item(p, ts):
    kind = p.get("type")
    if kind in ("function_call", "custom_tool_call"):
        name = p.get("name") or "tool"
        raw = p.get("arguments") if kind == "function_call" else p.get("input")
        if name == "exec":
            # A JavaScript wrapper; the commands it runs arrive as item_completed records.
            return [drop_none({"k": "call", "id": p.get("call_id"), "ts": ts, "name": "exec", "input": {"code": cap(raw or "", 16000)}, "wrapper": True})]
        try:
            value = json.loads(raw) if isinstance(raw, str) and raw.strip().startswith(("{", "[")) else raw
        except ValueError:
            value = raw
        if name == "apply_patch" and isinstance(value, str):
            value = {"patch": cap(value, 200000)}
        return [call(p.get("call_id"), ts, name, trim(value if isinstance(value, dict) else {"input": value}))]
    if kind in ("function_call_output", "custom_tool_call_output"):
        out = p.get("output")
        text = text_of(out) if isinstance(out, list) else (out if isinstance(out, str) else json.dumps(out, ensure_ascii=False))
        return [done(p.get("call_id"), ts, head_tail(text or "", RESULT_LIMIT))]
    if kind == "web_search_call":
        action = p.get("action") or {}
        return [call(p.get("id") or f"ws-{ts}", ts, "web_search", drop_none({"query": action.get("query")})), done(p.get("id") or f"ws-{ts}", ts)]
    return []


def meta_of(path):
    """(cwd, started_ms) from a rollout's first line, or (None, None)."""
    try:
        with open(path, "rb") as fh:
            first = fh.readline()
        payload = json.loads(first).get("payload") or {}
        return payload.get("cwd"), to_ms(payload.get("timestamp"))
    except (OSError, ValueError):
        return None, None
