#!/usr/bin/env python3
"""Create immutable revisions from operations; never write under decomposition/."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_revision_ids(job: Path) -> list[str]:
    root = job / "revisions"
    if not root.is_dir():
        return []
    ids = []
    for p in sorted(root.iterdir()):
        if p.is_dir() and re.fullmatch(r"revision-\d+", p.name):
            ids.append(p.name)
    return ids


def next_revision_id(job: Path) -> str:
    nums = []
    for rid in list_revision_ids(job):
        m = re.fullmatch(r"revision-(\d+)", rid)
        if m:
            nums.append(int(m.group(1)))
    n = (max(nums) + 1) if nums else 1
    return f"revision-{n:03d}"


def load_base_manifest(job: Path, parent_revision_id: str | None) -> dict:
    if not parent_revision_id or parent_revision_id == "original":
        path = job / "decomposition" / "layer-manifest.json"
        if not path.is_file():
            raise SystemExit(f"missing {path}")
        return read_json(path)
    path = job / "revisions" / parent_revision_id / "layer-manifest.json"
    if not path.is_file():
        raise SystemExit(f"missing parent manifest {path}")
    return read_json(path)


def apply_operations(manifest: dict, operations: list[dict[str, Any]]) -> dict:
    layers = [dict(L) for L in (manifest.get("layers") or [])]
    by_id = {L.get("id"): L for L in layers if L.get("id")}

    for op in operations:
        kind = op.get("op")
        lid = op.get("layer_id")
        if kind == "reorder_all":
            order_ids = op.get("order") or []
            index = {i: n for n, i in enumerate(order_ids)}
            for L in layers:
                if L.get("id") in index:
                    L["order"] = index[L["id"]]
            continue

        layer = by_id.get(lid)
        if not layer:
            raise SystemExit(f"unknown layer_id in op {kind}: {lid}")

        if kind == "rename":
            layer["name"] = str(op.get("value") or layer.get("name") or lid)
        elif kind == "set_opacity":
            layer["opacity"] = float(op.get("value", 1))
        elif kind == "set_visible":
            layer["visible"] = bool(op.get("value"))
        elif kind == "reorder":
            layer["order"] = int(op.get("index", layer.get("order", 0)))
        else:
            raise SystemExit(f"unsupported op: {kind}")

    layers.sort(key=lambda L: (L.get("order", 0), L.get("id") or ""))
    for i, L in enumerate(layers):
        if L.get("kind", "part") == "part":
            # keep relative denseness for parts only among parts
            pass
    out = dict(manifest)
    out["layers"] = layers
    return out


def create_revision(
    job: Path,
    *,
    operations: list[dict],
    parent_revision_id: str | None = "original",
    label: str | None = None,
    copy_pixels: bool = False,
) -> dict:
    job = job.resolve()
    decomp = job / "decomposition"
    if not decomp.is_dir():
        raise SystemExit("decomposition/ missing — refuse to create revision")

    # Guard: never write into decomposition
    rid = next_revision_id(job)
    rev_dir = job / "revisions" / rid
    if rev_dir.exists():
        raise SystemExit(f"revision exists: {rid}")
    rev_dir.mkdir(parents=True)

    base = load_base_manifest(job, parent_revision_id)
    resolved = apply_operations(base, operations)

    # Point part files at original decomposition paths (relative from revision dir)
    # Store as decomposition-relative paths; export_psd resolves via job/decomposition
    for L in resolved.get("layers") or []:
        if L.get("kind", "part") != "part":
            continue
        f = str(L.get("file") or "").replace("\\", "/")
        # normalize to layers/xxx.png under decomposition
        if f.startswith("layers/") or f.startswith("refs/") or f.startswith("depth/"):
            L["file"] = f
            L["pixelSource"] = "decomposition"
        if copy_pixels and L.get("kind") == "part":
            src = decomp / L["file"]
            if src.is_file():
                dest = rev_dir / L["file"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
                L["pixelSource"] = "revision"

    write_json(rev_dir / "layer-manifest.json", resolved)

    meta = {
        "revision_id": rid,
        "parent_revision_id": parent_revision_id if parent_revision_id != "original" else None,
        "source": parent_revision_id or "decomposition",
        "label": label or rid,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "operations": operations,
        "input_hash": base.get("input_hash"),
        "notes": [
            "Immutable revision. Does not modify decomposition/.",
            "Metadata ops only unless copy_pixels=true or future mask files are added.",
        ],
    }
    write_json(rev_dir / "revision.json", meta)

    # Touch job.json activeRevision if present
    job_json = job / "job.json"
    if job_json.is_file():
        job_data = read_json(job_json)
        job_data["activeRevision"] = rid
        job_data["updatedAt"] = datetime.now(timezone.utc).isoformat()
        if job_data.get("live2d_ready"):
            job_data["live2d_ready"] = False
        write_json(job_json, job_data)

    print(json.dumps({"revision_id": rid, "path": str(rev_dir)}, ensure_ascii=False))
    return meta


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--parent", default="original")
    parser.add_argument("--label", default=None)
    parser.add_argument("--ops-json", required=True, help="JSON array of operations or path to file")
    args = parser.parse_args()
    raw = args.ops_json
    p = Path(raw)
    if p.is_file():
        operations = read_json(p)
        if isinstance(operations, dict) and "operations" in operations:
            operations = operations["operations"]
    else:
        operations = json.loads(raw)
    if not isinstance(operations, list):
        raise SystemExit("operations must be a list")
    create_revision(args.job, operations=operations, parent_revision_id=args.parent, label=args.label)


if __name__ == "__main__":
    main()
