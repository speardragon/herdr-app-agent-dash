#!/usr/bin/env python3
"""The picture of whoever uses the mod, for the prompt chat view.

Who that is comes from this computer, offline, in this order:
  1. a picture you put at <mod>/.me/avatar.(png|jpg|webp|gif)  (always wins)
  2. the GitHub noreply email in `git config user.email`  (123+name@users.noreply.github.com)
  3. `git config github.user`
  4. the account `gh` is logged in as (the `user:` line of ~/.config/gh/hosts.yml; no token is read)
The GitHub picture is downloaded once into <mod>/.me/ and reused. A failed attempt is not repeated
for a day. Create <mod>/.me/no-avatar (an empty file) to never fetch anything.

    python3 me.py ensure     -> {"path": "<file>"}  or  {"path": null}
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

MOD = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FOLDER = os.path.join(MOD, ".me")
EXTS = ("png", "jpg", "jpeg", "webp", "gif")
KINDS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
LIMIT = 512 * 1024
RETRY_SECONDS = 24 * 3600
NAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")


def existing():
    for ext in EXTS:
        path = os.path.join(FOLDER, f"avatar.{ext}")
        if os.path.isfile(path):
            return path
    return None


def git(*args):
    try:
        done = subprocess.run(["git", "config", "--global", *args], capture_output=True, text=True, timeout=4)
        return done.stdout.strip() if done.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def gh_user():
    """The account `gh` is logged in as; only the `user:` line is read."""
    path = os.path.join(os.environ.get("GH_CONFIG_DIR") or os.path.expanduser("~/.config/gh"), "hosts.yml")
    try:
        inside = False
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if not line.startswith(" ") and line.strip():
                    inside = line.startswith("github.com:")
                elif inside:
                    found = re.match(r"^\s{1,4}user:\s*(\S+)\s*$", line)
                    if found:
                        return found.group(1)
    except OSError:
        pass
    return ""


def avatar_url():
    noreply = re.fullmatch(r"(\d+)\+([^@]+)@users\.noreply\.github\.com", git("user.email"))
    if noreply:
        return f"https://avatars.githubusercontent.com/u/{noreply.group(1)}?s=160"
    for name in (git("github.user"), gh_user()):
        if NAME.match(name or ""):
            return f"https://github.com/{name}.png?size=160"
    return None


def png_bits(blob):
    return blob[24] if blob[:8] == b"\x89PNG\r\n\x1a\n" and len(blob) > 25 else 8


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "agent-dash-avatar"})
    with urllib.request.urlopen(request, timeout=6) as response:  # noqa: S310 (https URLs built above)
        kind = (response.headers.get_content_type() or "").lower()
        blob = response.read(LIMIT + 1)
    if kind not in KINDS or len(blob) > LIMIT:
        return None
    return kind, blob


def save(kind, blob):
    os.makedirs(FOLDER, exist_ok=True)
    path = os.path.join(FOLDER, f"avatar.{KINDS[kind]}")
    with open(path, "wb") as fh:
        fh.write(blob)
    # The app's image loader is only sure of 8-bit pictures: a 16-bit PNG becomes a JPEG (macOS `sips`).
    if kind == "image/png" and png_bits(blob) > 8 and shutil.which("sips"):
        jpg = os.path.join(FOLDER, "avatar.jpg")
        done = subprocess.run(["sips", "-s", "format", "jpeg", path, "--out", jpg], capture_output=True, timeout=10)
        if done.returncode == 0 and os.path.isfile(jpg):
            os.remove(path)
            return jpg
    return path


def ensure():
    found = existing()
    if found or os.path.exists(os.path.join(FOLDER, "no-avatar")):
        return found
    tried = os.path.join(FOLDER, ".tried")
    if os.path.exists(tried) and time.time() - os.path.getmtime(tried) < RETRY_SECONDS:
        return None
    url = avatar_url()
    os.makedirs(FOLDER, exist_ok=True)
    with open(tried, "w", encoding="utf-8"):
        pass  # noted first: a slow or failing network is not asked again and again
    if not url:
        return None
    try:
        got = fetch(url)
    except (OSError, urllib.error.URLError, ValueError):
        return None
    return save(*got) if got else None


def main(argv):
    if len(argv) > 1 and argv[1] == "ensure":
        print(json.dumps({"path": ensure()}))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
