#!/usr/bin/env python3
"""Create immutable revisions from operations; never write under decomposition/."""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REVISION_ID_RE = re.compile(r"^revision-\d{3,}$")
PARENT_ID_RE = re.compile(r"^(original|revision-\d{3,})$")


class RevisionError(ValueError):
    """Invalid revision input; no directory should be left behind."""


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def validate_revision_id(revision_id: str, *, allow_original: bool = False) -> str:
    rid = str(revision_id or "").strip()
    if allow_original and rid == "original":
        return rid
    if not REVISION_ID_RE.fullmatch(rid):
        raise RevisionError(f"invalid revision_id: {revision_id!r}")
    if ".." in rid or "/" in rid or "\\" in rid:
        raise RevisionError(f"illegal revision_id path: {revision_id!r}")
    return rid


def validate_parent_id(parent_revision_id: str | None) -> str:
    parent = "original" if not parent_revision_id else str(parent_revision_id).strip()
    if not PARENT_ID_RE.fullmatch(parent):
        raise RevisionError(f"invalid parent_revision_id: {parent_revision_id!r}")
    if ".." in parent or "/" in parent or "\\" in parent:
        raise RevisionError(f"illegal parent_revision_id path: {parent_revision_id!r}")
    return parent


def list_revision_ids(job: Path) -> list[str]:
    root = job / "revisions"
    if not root.is_dir():
        return []
    ids = []
    for p in sorted(root.iterdir()):
        if p.is_dir() and REVISION_ID_RE.fullmatch(p.name):
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
    parent = validate_parent_id(parent_revision_id)
    if parent == "original":
        path = job / "decomposition" / "layer-manifest.json"
        if not path.is_file():
            raise RevisionError(f"missing {path}")
        return read_json(path)
    path = job / "revisions" / parent / "layer-manifest.json"
    if not path.is_file():
        raise RevisionError(f"missing parent manifest {path}")
    return read_json(path)


def _part_ids(layers: list[dict]) -> list[str]:
    return [str(L["id"]) for L in layers if L.get("kind", "part") == "part" and L.get("id")]


def validate_operations(manifest: dict, operations: list[dict[str, Any]]) -> None:
    if not isinstance(operations, list) or not operations:
        raise RevisionError("operations must be a non-empty list")

    layers = list(manifest.get("layers") or [])
    by_id = {str(L.get("id")): L for L in layers if L.get("id")}
    part_ids = set(_part_ids(layers))
    if not part_ids:
        raise RevisionError("manifest has no part layers")

    for i, op in enumerate(operations):
        if not isinstance(op, dict):
            raise RevisionError(f"op[{i}] must be an object")
        kind = op.get("op")
        if kind == "reorder_all":
            order_ids = op.get("order")
            if not isinstance(order_ids, list) or not order_ids:
                raise RevisionError("reorder_all.order must be a non-empty list")
            order_ids = [str(x) for x in order_ids]
            if len(order_ids) != len(set(order_ids)):
                raise RevisionError("reorder_all.order contains duplicate layer_id")
            missing = part_ids - set(order_ids)
            extra = set(order_ids) - part_ids
            if missing:
                raise RevisionError(f"reorder_all missing layer_ids: {sorted(missing)}")
            if extra:
                raise RevisionError(f"reorder_all unknown layer_ids: {sorted(extra)}")
            continue

        lid = op.get("layer_id")
        if not lid or str(lid) not in by_id:
            raise RevisionError(f"op[{i}] unknown layer_id: {lid!r}")
        layer = by_id[str(lid)]
        if layer.get("kind", "part") != "part" and kind in {
            "rename",
            "set_opacity",
            "set_visible",
            "reorder",
        }:
            # Allow edits only on part layers for phase-2 structure ops
            raise RevisionError(f"op[{i}] layer {lid} is not a part layer")

        if kind == "rename":
            value = op.get("value")
            if value is None or str(value).strip() == "":
                raise RevisionError(f"op[{i}] rename value must be non-empty")
            if "\x00" in str(value):
                raise RevisionError(f"op[{i}] rename value contains NUL")
        elif kind == "set_opacity":
            try:
                opacity = float(op.get("value", 1))
            except (TypeError, ValueError) as e:
                raise RevisionError(f"op[{i}] opacity not a number") from e
            if not math.isfinite(opacity) or opacity < 0.0 or opacity > 1.0:
                raise RevisionError(f"op[{i}] opacity must be finite in [0, 1], got {opacity!r}")
        elif kind == "set_visible":
            if not isinstance(op.get("value"), bool):
                raise RevisionError(f"op[{i}] set_visible value must be bool")
        elif kind == "reorder":
            try:
                index = int(op.get("index"))
            except (TypeError, ValueError) as e:
                raise RevisionError(f"op[{i}] reorder index must be int") from e
            if index < 0 or index >= len(part_ids):
                raise RevisionError(f"op[{i}] reorder index out of range: {index}")
        else:
            raise RevisionError(f"op[{i}] unsupported op: {kind!r}")


def apply_operations(manifest: dict, operations: list[dict[str, Any]]) -> dict:
    validate_operations(manifest, operations)
    layers = [dict(L) for L in (manifest.get("layers") or [])]
    # Preserve stable id identity
    for L in layers:
        if L.get("id") is not None:
            L["id"] = str(L["id"])
    by_id = {L.get("id"): L for L in layers if L.get("id")}
    part_layers = [L for L in layers if L.get("kind", "part") == "part"]

    for op in operations:
        kind = op.get("op")
        if kind == "reorder_all":
            order_ids = [str(x) for x in (op.get("order") or [])]
            index = {i: n for n, i in enumerate(order_ids)}
            for L in part_layers:
                L["order"] = index[str(L["id"])]
            continue

        lid = str(op.get("layer_id"))
        layer = by_id[lid]
        if kind == "rename":
            layer["name"] = str(op.get("value")).strip()
        elif kind == "set_opacity":
            layer["opacity"] = float(op.get("value"))
        elif kind == "set_visible":
            layer["visible"] = bool(op.get("value"))
        elif kind == "reorder":
            # Move this part among parts to absolute index; densify afterward
            target = int(op["index"])
            ordered = sorted(part_layers, key=lambda L: (L.get("order", 0), L.get("id") or ""))
            ordered = [L for L in ordered if L.get("id") != lid]
            ordered.insert(target, layer)
            for n, L in enumerate(ordered):
                L["order"] = n

    # Densify part orders uniquely; keep non-part orders after parts
    parts_sorted = sorted(
        [L for L in layers if L.get("kind", "part") == "part"],
        key=lambda L: (L.get("order", 0), L.get("id") or ""),
    )
    for n, L in enumerate(parts_sorted):
        L["order"] = n
    non_parts = [L for L in layers if L.get("kind", "part") != "part"]
    for n, L in enumerate(non_parts):
        L["order"] = 1000 + n

    orders = [L["order"] for L in parts_sorted]
    if len(orders) != len(set(orders)):
        raise RevisionError("part order values are not unique after apply")

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
        raise RevisionError("decomposition/ missing — refuse to create revision")

    parent = validate_parent_id(parent_revision_id)
    base = load_base_manifest(job, parent)
    # Validate BEFORE creating any directory
    resolved = apply_operations(base, operations)

    rid = next_revision_id(job)
    validate_revision_id(rid)
    rev_dir = job / "revisions" / rid
    if rev_dir.exists():
        raise RevisionError(f"revision exists: {rid}")

    try:
        rev_dir.mkdir(parents=True)
        for L in resolved.get("layers") or []:
            if L.get("kind", "part") != "part":
                continue
            # Keep stable id
            L["id"] = str(L.get("id"))
            f = str(L.get("file") or "").replace("\\", "/")
            if f.startswith("layers/") or f.startswith("refs/") or f.startswith("depth/"):
                L["file"] = f
                L["pixelSource"] = "decomposition"
            if copy_pixels:
                src = decomp / L["file"]
                if src.is_file():
                    dest = rev_dir / L["file"]
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
                    L["pixelSource"] = "revision"

        write_json(rev_dir / "layer-manifest.json", resolved)
        meta = {
            "revision_id": rid,
            "parent_revision_id": None if parent == "original" else parent,
            "source": parent,
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

        job_json = job / "job.json"
        if job_json.is_file():
            job_data = read_json(job_json)
            job_data["activeRevision"] = rid
            job_data["updatedAt"] = datetime.now(timezone.utc).isoformat()
            job_data["live2d_ready"] = False
            write_json(job_json, job_data)

        print(json.dumps({"revision_id": rid, "path": str(rev_dir)}, ensure_ascii=False))
        return meta
    except Exception:
        if rev_dir.exists():
            shutil.rmtree(rev_dir, ignore_errors=True)
        raise


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
    try:
        create_revision(args.job, operations=operations, parent_revision_id=args.parent, label=args.label)
    except RevisionError as e:
        raise SystemExit(str(e)) from e


if __name__ == "__main__":
    main()
