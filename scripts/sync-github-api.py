#!/usr/bin/env python3
"""
Push local HEAD changes to GitHub main via Git Data API.

Use when git HTTPS to github.com is blocked but api.github.com works.
Requires: gh auth token in GH_TOKEN or `gh auth token`.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = os.environ.get("GITHUB_REPO", "furiberto/furiberto-first-repository")
ROOT = Path(__file__).resolve().parents[1]
SAFE = [
    "-c",
    f"safe.directory={ROOT.as_posix()}",
    "-c",
    "core.quotepath=false",
]


def git(*args: str) -> str:
    out = subprocess.check_output(["git", *SAFE, *args], cwd=ROOT)
    return out.decode("utf-8", errors="replace").strip()


def token() -> str:
    env = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if env:
        return env.strip()
    return subprocess.check_output(["gh", "auth", "token"], text=True).strip()


def api(method: str, path: str, data=None):
    url = f"https://api.github.com{path}"
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", f"Bearer {token()}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code} {path}: {err[:1200]}") from e


def parse_name_status(rev: str) -> list[tuple[str, str]]:
    raw = git("show", "--name-status", "--pretty=format:", rev)
    entries: list[tuple[str, str]] = []
    for line in raw.splitlines():
        line = line.strip("\r")
        if not line:
            continue
        parts = line.split("\t")
        status = parts[0]
        if status.startswith("R") or status.startswith("C"):
            entries.append(("A", parts[-1]))
            if status.startswith("R"):
                entries.append(("D", parts[1]))
        elif status.startswith("D"):
            entries.append(("D", parts[1]))
        else:
            entries.append((status[0], parts[1]))
    return entries


def main() -> None:
    branch = sys.argv[1] if len(sys.argv) > 1 else "main"
    local = git("rev-parse", "HEAD")
    msg = git("log", "-1", "--pretty=%B")
    print(f"local HEAD={local}", flush=True)

    ref = api("GET", f"/repos/{REPO}/git/ref/heads/{branch}")
    remote_sha = ref["object"]["sha"]
    print(f"remote {branch}={remote_sha}", flush=True)
    if remote_sha == local:
        print("already in sync")
        return

    remote_commit = api("GET", f"/repos/{REPO}/git/commits/{remote_sha}")
    base_tree = remote_commit["tree"]["sha"]

    # Prefer pushing only the tip commit if it is a single ahead commit;
    # otherwise fall back to full tip tree vs remote (still tip commit message).
    entries = parse_name_status("HEAD")
    # If local history diverged (API prior push), still apply tip commit file list
    # onto remote tip — correct when tip commit only contains new work.
    print(f"entries from HEAD commit: {len(entries)}", flush=True)

    tree_items = []
    for i, (st, path) in enumerate(entries, 1):
        path = path.replace("\\", "/")
        if st == "D":
            tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
            print(f"[{i}/{len(entries)}] DELETE {path}", flush=True)
            continue
        abs_path = ROOT / path
        if not abs_path.is_file():
            raise SystemExit(f"missing file: {abs_path}")
        rawb = abs_path.read_bytes()
        blob = api(
            "POST",
            f"/repos/{REPO}/git/blobs",
            {"content": base64.b64encode(rawb).decode("ascii"), "encoding": "base64"},
        )
        tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"[{i}/{len(entries)}] BLOB {path} ({len(rawb)} bytes)", flush=True)

    tree = api("POST", f"/repos/{REPO}/git/trees", {"base_tree": base_tree, "tree": tree_items})
    commit = api(
        "POST",
        f"/repos/{REPO}/git/commits",
        {
            "message": msg,
            "tree": tree["sha"],
            "parents": [remote_sha],
            "author": {"name": "furiberto", "email": "furiberto@users.noreply.github.com"},
            "committer": {"name": "furiberto", "email": "furiberto@users.noreply.github.com"},
        },
    )
    updated = api(
        "PATCH",
        f"/repos/{REPO}/git/refs/heads/{branch}",
        {"sha": commit["sha"], "force": False},
    )
    sha = updated["object"]["sha"]
    print(f"PUSH_VIA_API_OK {sha}", flush=True)
    print(f"https://github.com/{REPO}/commit/{sha}", flush=True)


if __name__ == "__main__":
    main()
