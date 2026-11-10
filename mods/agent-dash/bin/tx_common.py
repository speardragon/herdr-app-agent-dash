"""Shared helpers for the transcript reader: time parsing, size caps and trimming."""

import json
import re
from datetime import datetime

# Base64 payloads (pasted images, screenshots) are most of a long transcript's bytes.
# Dropping them before JSON decoding keeps a 60 MB file cheap to read.
BASE64_FIELD = re.compile(rb'"(data|base64)":"[A-Za-z0-9+/=]{200,}"')

CUT_MARK = "[[cut {}]]"


def strip_base64(raw):
    if b'"type":"image"' not in raw and b'"base64"' not in raw:
        return raw
    return BASE64_FIELD.sub(rb'"\1":""', raw)


def to_ms(value):
    """ISO-8601 (with Z) or epoch seconds/ms -> epoch milliseconds, or None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value if value > 1e12 else value * 1000)
    try:
        return int(datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def cap(text, limit):
    """Keeps the head of a long string and says how much was left out."""
    if not isinstance(text, str) or len(text) <= limit:
        return text
    return text[:limit] + "\n" + CUT_MARK.format(len(text) - limit)


def head_tail(text, limit):
    """Keeps both ends of a long log: the command line and the verdict usually matter most."""
    if not isinstance(text, str) or len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\n" + CUT_MARK.format(len(text) - limit) + "\n" + text[-half:]


def trim(value, limit=64000, items=2000, depth=0):
    """Caps every string and list inside a JSON value without changing its shape."""
    if depth > 40:
        return None
    if isinstance(value, str):
        return cap(value, limit)
    if isinstance(value, list):
        kept = [trim(v, limit, items, depth + 1) for v in value[:items]]
        if len(value) > items:
            kept.append(CUT_MARK.format(len(value) - items))
        return kept
    if isinstance(value, dict):
        return {k: trim(v, limit, items, depth + 1) for k, v in value.items()}
    return value


def text_of(content):
    """Text of a tool result or message: a string, or a list of blocks with text."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        if isinstance(block, dict) and isinstance(block.get("text"), str):
            parts.append(block["text"])
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def count_images(content):
    if not isinstance(content, list):
        return 0
    return sum(1 for b in content if isinstance(b, dict) and b.get("type") in ("image", "input_image"))


def small(value, limit=8000):
    """The value itself when its JSON is small, else None."""
    try:
        return value if len(json.dumps(value, ensure_ascii=False)) <= limit else None
    except (TypeError, ValueError):
        return None


def drop_none(record):
    return {k: v for k, v in record.items() if v is not None and v != "" and v != [] and v != {}}
