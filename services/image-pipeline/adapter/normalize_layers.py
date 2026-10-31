"""Normalize See-through output folders into job decomposition/ layers + manifest."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from layer_manifest import build_manifest, write_manifest

# Semantic paint order: index 0 drawn first (back). Matches typical anime stack.
BACK_TO_FRONT: list[str] = [
    "objects",
    "wings",
    "tail",
    "back hair",
    "footwear",
    "legwear",
    "bottomwear",
    "handwear",
    "topwear",
    "neckwear",
    "neck",
    "ears",
    "earwear",
    "face",
    "eyewhite",
    "irides",
    "eyelash",
    "eyebrow",
    "eyewear",
    "nose",
    "mouth",
    "front hair",
    "headwear",
    "head",  # optional composite; keep near face if present
]

SKIP_STEMS = {
    "reconstruction",
    "src_img",
    "src_head",
    "stats",
}


def _slug(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^\w\-]+", "-", s, flags=re.UNICODE)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "layer"


def _safe_filename(tag: str) -> str:
    return f"{_slug(tag)}.png"


def discover_upstream_dir(job_or_upstream: Path) -> Path | None:
    """Accept job root, upstream save_dir, or …/sample folder."""
    p = job_or_upstream.resolve()
    if (p / "info.json").is_file():
        return p
    cand = p / "decomposition" / "upstream"
    if cand.is_dir():
        # save_dir may contain <stem>/info.json or flat
        for child in sorted(cand.iterdir()):
            if child.is_dir() and (child / "info.json").is_file():
                return child
        if (cand / "info.json").is_file():
            return cand
    # phase0 first-run style: parent has sample/ + sample.psd
    for child in sorted(p.iterdir()) if p.is_dir() else []:
        if child.is_dir() and (child / "info.json").is_file():
            return child
    return None


def load_part_meta(upstream: Path) -> dict[str, Any]:
    info: dict[str, Any] = {}
    info_path = upstream / "info.json"
    if info_path.is_file():
        info = json.loads(info_path.read_text(encoding="utf-8"))
    parts = info.get("parts") if isinstance(info.get("parts"), dict) else {}

    # sibling *.psd.json next to folder (See-through writes <stem>.psd.json beside <stem>/)
    bbox_by_tag: dict[str, list[int]] = {}
    for meta_path in list(upstream.glob("*.psd.json")) + list(upstream.parent.glob("*.psd.json")):
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        for tag, entry in (data.get("parts") or {}).items():
            if isinstance(entry, dict) and "xyxy" in entry:
                bbox_by_tag[tag] = entry["xyxy"]
    return {"parts": parts, "bbox": bbox_by_tag}


def list_part_pngs(upstream: Path) -> list[Path]:
    out: list[Path] = []
    for png in sorted(upstream.glob("*.png")):
        stem = png.stem
        if stem.endswith("_depth"):
            continue
        if stem in SKIP_STEMS:
            continue
        out.append(png)
    return out


def normalize_from_upstream(
    upstream: Path,
    paths: dict[str, Path],
    *,
    input_path: Path | None = None,
    backend: str = "see-through-quantized",
) -> tuple[list[dict], str | None]:
    """Copy colour part PNGs + depth into job tree; write layer-manifest.json."""
    upstream = upstream.resolve()
    meta = load_part_meta(upstream)
    order_index = {name: i for i, name in enumerate(BACK_TO_FRONT)}

    # Prefer PSD colour export if present beside upstream folder
    psd_rel = None
    search_psd = list(upstream.parent.glob("*.psd"))
    # Also accept PSDs already placed in exports/ (ingest path)
    search_psd += list(paths["exports"].glob("*.psd"))
    seen = set()
    for psd in search_psd:
        key = psd.name.lower()
        if key in seen:
            continue
        seen.add(key)
        if "depth" in key:
            dest = paths["depth"] / psd.name
            if not dest.exists():
                shutil.copy2(psd, dest)
            continue
        dest_ex = paths["exports"] / psd.name
        dest_dec = paths["decomposition"] / psd.name
        if not dest_ex.exists():
            shutil.copy2(psd, dest_ex)
        if not dest_dec.exists():
            shutil.copy2(psd, dest_dec)
        psd_rel = f"exports/{psd.name}"

    layers: list[dict] = []
    for png in list_part_pngs(upstream):
        tag = png.stem
        fname = _safe_filename(tag)
        dest = paths["layers"] / fname
        shutil.copy2(png, dest)

        depth_src = upstream / f"{tag}_depth.png"
        depth_rel = None
        if depth_src.is_file():
            depth_name = _safe_filename(tag).replace(".png", "_depth.png")
            depth_dest = paths["depth"] / depth_name
            shutil.copy2(depth_src, depth_dest)
            depth_rel = f"depth/{depth_name}"

        order = order_index.get(tag, 500 + len(layers))
        entry: dict[str, Any] = {
            "id": _slug(tag),
            "name": tag,
            "file": f"layers/{fname}",
            "order": order,
            "visible": True,
            "opacity": 1,
            "kind": "part",
        }
        if depth_rel:
            entry["depthFile"] = depth_rel
        if tag in meta["bbox"]:
            entry["bbox"] = meta["bbox"][tag]
        layers.append(entry)

    layers.sort(key=lambda L: (L["order"], L["id"]))
    # re-number densely for UI
    for i, layer in enumerate(layers):
        layer["order"] = i

    # Reference images (not editable parts)
    notes = [
        "Normalized See-through colour parts only (depth/reconstruction excluded from edit list).",
        "AI original lives under decomposition/; edits must go to revisions/.",
    ]
    for ref_name, kind in (
        ("reconstruction.png", "reconstruction"),
        ("src_img.png", "source_ref"),
        ("src_head.png", "source_ref"),
    ):
        src = upstream / ref_name
        if not src.is_file():
            continue
        dest = paths["decomposition"] / "refs" / ref_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        layers.append(
            {
                "id": _slug(ref_name),
                "name": ref_name,
                "file": f"refs/{ref_name}",
                "order": 900 + len(layers),
                "visible": False,
                "opacity": 1,
                "kind": kind,
            }
        )

    manifest = build_manifest(
        input_path=input_path or (paths["source"] / "original.png"),
        layers=[L for L in layers if L.get("kind") == "part"],
        psd=psd_rel,
        backend=backend,
        model_version="layerdiff-nf4",
        notes=notes,
    )
    # Keep full layer list (incl. refs) for the review UI
    manifest["layers"] = layers
    manifest["frame"] = {"width": None, "height": None}
    # Infer frame from first part
    try:
        from PIL import Image

        first = paths["layers"] / Path(layers[0]["file"]).name
        if first.is_file():
            with Image.open(first) as im:
                manifest["frame"] = {"width": im.width, "height": im.height}
    except Exception:
        pass

    write_manifest(paths["decomposition"] / "layer-manifest.json", manifest)
    # Also store original snapshot marker
    (paths["decomposition"] / "ORIGINAL.txt").write_text(
        "Do not edit files in this folder for review corrections.\n"
        "Save human edits under revisions/revision-NNN/.\n",
        encoding="utf-8",
    )
    return layers, psd_rel
