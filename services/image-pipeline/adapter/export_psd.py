#!/usr/bin/env python3
"""
Export a PSD from a job revision (or AI original).

Authoritative pixels: decomposition/layers/*.png (or revision overrides).
Does not modify decomposition/. Uses psd_tools (same stack as See-through).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

try:
    from psd_tools import PSDImage
except ImportError as e:  # pragma: no cover
    raise SystemExit(f"psd_tools required: {e}") from e


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_resolved_manifest(job: Path, revision_id: str) -> tuple[dict, Path]:
    """Return (manifest, pixel_root) for the revision."""
    if revision_id in (None, "", "original"):
        man = job / "decomposition" / "layer-manifest.json"
        if not man.is_file():
            raise SystemExit(f"missing {man}")
        return read_json(man), job / "decomposition"

    rev_dir = job / "revisions" / revision_id
    man = rev_dir / "layer-manifest.json"
    if man.is_file():
        return read_json(man), rev_dir

    # Metadata-only revision: ops applied at resolve time by caller; fall back to original pixels
    orig = job / "decomposition" / "layer-manifest.json"
    if not orig.is_file():
        raise SystemExit(f"missing original manifest and {man}")
    return read_json(orig), job / "decomposition"


def resolve_layer_image(pixel_root: Path, job: Path, layer: dict) -> Path:
    rel = str(layer.get("file") or "").replace("\\", "/")
    if not rel:
        raise SystemExit(f"layer {layer.get('id')} has no file")
    candidates = [
        pixel_root / rel,
        pixel_root / Path(rel).name,
        job / "decomposition" / rel,
        job / "decomposition" / "layers" / Path(rel).name,
    ]
    for c in candidates:
        if c.is_file():
            return c
    raise SystemExit(f"layer image not found for {layer.get('id')}: {rel}")


def export_psd(
    job: Path,
    *,
    revision_id: str = "original",
    out_name: str | None = None,
    skip_empty: bool = False,
    alpha_threshold: int = 10,
) -> dict:
    job = job.resolve()
    manifest, pixel_root = load_resolved_manifest(job, revision_id)
    parts = [L for L in (manifest.get("layers") or []) if L.get("kind", "part") == "part"]
    if not parts:
        raise SystemExit("no part layers to export")

    frame = manifest.get("frame") or {}
    w = int(frame.get("width") or 1024)
    h = int(frame.get("height") or 1024)

    exports = job / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    rev_slug = revision_id or "original"
    out_path = exports / (out_name or f"export-{rev_slug}-{stamp}.psd")

    ordered = sorted(parts, key=lambda L: (L.get("order", 0), L.get("id") or ""))
    psd = PSDImage.new(mode="RGBA", size=(w, h), depth=8)
    written = []

    for layer in ordered:
        if layer.get("visible") is False:
            # Still include invisible layers so Cubism can toggle; mark visible=False
            include_hidden = True
        else:
            include_hidden = True
        if not include_hidden:
            continue

        img_path = resolve_layer_image(pixel_root, job, layer)
        im = Image.open(img_path).convert("RGBA")
        if im.size != (w, h):
            canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            # If bbox present, paste at bbox; else top-left
            bbox = layer.get("bbox")
            if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                x1, y1, x2, y2 = [int(v) for v in bbox]
                region = im
                if region.size != (x2 - x1, y2 - y1):
                    canvas.paste(im, (x1, y1), im)
                else:
                    canvas.paste(region, (x1, y1), region)
            else:
                canvas.paste(im, (0, 0), im)
            im = canvas

        if skip_empty:
            alpha = im.getchannel("A")
            if not any(px > alpha_threshold for px in alpha.getdata()):
                continue

        opacity = layer.get("opacity", 1)
        try:
            opacity_i = int(round(float(opacity) * 255))
        except (TypeError, ValueError):
            opacity_i = 255
        opacity_i = max(0, min(255, opacity_i))

        name = str(layer.get("name") or layer.get("id") or "layer")
        pl = psd.create_pixel_layer(im, name=name, top=0, left=0, opacity=opacity_i)
        if layer.get("visible") is False:
            pl.visible = False
        written.append(
            {
                "id": layer.get("id"),
                "name": name,
                "order": layer.get("order"),
                "opacity": opacity_i,
                "visible": layer.get("visible", True) is not False,
                "source": str(img_path.relative_to(job)).replace("\\", "/"),
            }
        )

    if not written:
        raise SystemExit("no layers written (all empty?)")

    # utf-8 keeps CJK layer names; macroman (psd_tools default) cannot
    psd.save(out_path, encoding="utf-8")

    # Round-trip verification
    verify = {"ok": False, "errors": []}
    try:
        again = PSDImage.open(out_path, encoding="utf-8")
        names = [L.name for L in again]
        expect = [w["name"] for w in written]
        if again.width != w or again.height != h:
            verify["errors"].append(f"canvas {again.width}x{again.height} != {w}x{h}")
        if names != expect:
            verify["errors"].append(f"name/order mismatch: got {names!r}")
        if len(list(again)) != len(written):
            verify["errors"].append("layer count mismatch")
        verify["ok"] = len(verify["errors"]) == 0
        verify["layer_count"] = len(list(again))
        verify["canvas"] = [again.width, again.height]
        verify["names"] = names
    except Exception as e:  # pragma: no cover
        verify["errors"].append(str(e))

    report = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "revision_id": rev_slug,
        "psd": f"exports/{out_path.name}",
        "layer_count": len(written),
        "canvas": [w, h],
        "layers": written,
        "verify": verify,
        "notes": [
            "Pixels from PNG parts + revision metadata; AI original PSD is not the export authority.",
            "live2d_ready must remain false after export.",
        ],
    }
    report_path = exports / f"{out_path.stem}.export.json"
    write_json(report_path, report)
    print(json.dumps({"psd": str(out_path), "verify_ok": verify["ok"], "layers": len(written)}, ensure_ascii=False))
    if not verify["ok"]:
        print("VERIFY_FAIL", verify["errors"], file=sys.stderr)
        raise SystemExit(2)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Export PSD from job revision")
    parser.add_argument("--job", required=True, type=Path)
    parser.add_argument("--revision", default="original")
    parser.add_argument("--out-name", default=None)
    parser.add_argument("--skip-empty", action="store_true")
    args = parser.parse_args()
    export_psd(args.job, revision_id=args.revision, out_name=args.out_name, skip_empty=args.skip_empty)


if __name__ == "__main__":
    main()
