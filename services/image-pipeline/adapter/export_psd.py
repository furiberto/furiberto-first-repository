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

import numpy as np
from PIL import Image

try:
    from psd_tools import PSDImage
except ImportError as e:  # pragma: no cover
    raise SystemExit(f"psd_tools required: {e}") from e

from revision_ops import RevisionError, validate_parent_id, validate_revision_id


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

    rid = validate_revision_id(revision_id)
    rev_dir = job / "revisions" / rid
    man = rev_dir / "layer-manifest.json"
    if man.is_file():
        # Metadata-only revisions keep pixels in decomposition/; resolve_layer_image falls back.
        return read_json(man), rev_dir

    raise SystemExit(f"missing revision manifest {man}")


def resolve_layer_image(pixel_root: Path, job: Path, layer: dict) -> Path:
    rel = str(layer.get("file") or "").replace("\\", "/")
    if not rel or ".." in rel.split("/"):
        raise SystemExit(f"layer {layer.get('id')} has illegal file: {rel!r}")
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


def _opacity_byte(opacity: object) -> int:
    try:
        value = float(opacity)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        value = 1.0
    value = max(0.0, min(1.0, value))
    return int(round(value * 255))


def verify_exported_psd(
    out_path: Path,
    *,
    written: list[dict],
    expected_images: list[Image.Image],
    canvas: tuple[int, int],
    pixel_atol: int = 0,
) -> dict:
    verify: dict = {"ok": False, "errors": [], "checks": {}}
    w, h = canvas
    try:
        again = PSDImage.open(out_path, encoding="utf-8")
        layers = list(again)
        names = [L.name for L in layers]
        expect_names = [row["name"] for row in written]
        verify["checks"]["canvas"] = [again.width, again.height]
        verify["checks"]["layer_count"] = len(layers)
        verify["checks"]["names"] = names

        if again.width != w or again.height != h:
            verify["errors"].append(f"canvas {again.width}x{again.height} != {w}x{h}")
        if len(layers) != len(written):
            verify["errors"].append(f"layer count {len(layers)} != {len(written)}")
        if names != expect_names:
            verify["errors"].append(f"name/order mismatch: got {names!r}")

        for i, (layer, meta, src_im) in enumerate(zip(layers, written, expected_images)):
            if bool(layer.visible) != bool(meta["visible"]):
                verify["errors"].append(
                    f"layer[{i}] {meta['name']!r} visible {layer.visible} != {meta['visible']}"
                )
            if int(layer.opacity) != int(meta["opacity"]):
                verify["errors"].append(
                    f"layer[{i}] {meta['name']!r} opacity {layer.opacity} != {meta['opacity']}"
                )
            # Full-canvas export: bbox should cover canvas
            bbox = tuple(layer.bbox)
            if bbox != (0, 0, w, h) and bbox != (0, 0, 0, 0):
                # empty layers may collapse; non-empty must be full-canvas for this exporter
                topil = layer.topil()
                if topil is not None and max(topil.size) > 0:
                    if bbox[0] != 0 or bbox[1] != 0 or bbox[2] != w or bbox[3] != h:
                        # Accept if composite size matches canvas after paste semantics
                        if topil.size != (w, h):
                            verify["errors"].append(
                                f"layer[{i}] {meta['name']!r} bbox/size {bbox}/{topil.size} not full canvas"
                            )

            topil = layer.topil()
            if topil is None:
                verify["errors"].append(f"layer[{i}] {meta['name']!r} topil() is None")
                continue
            got = np.array(topil.convert("RGBA"), dtype=np.int16)
            exp = np.array(src_im.convert("RGBA"), dtype=np.int16)
            if got.shape != exp.shape:
                verify["errors"].append(
                    f"layer[{i}] {meta['name']!r} pixel shape {got.shape} != {exp.shape}"
                )
                continue
            diff = np.abs(got - exp)
            if pixel_atol <= 0:
                if not np.array_equal(got, exp):
                    max_d = int(diff.max())
                    bad = int((diff.max(axis=-1) > 0).sum())
                    verify["errors"].append(
                        f"layer[{i}] {meta['name']!r} pixel mismatch (bad_px={bad}, max_delta={max_d})"
                    )
            else:
                if int(diff.max()) > pixel_atol:
                    verify["errors"].append(
                        f"layer[{i}] {meta['name']!r} pixel delta {int(diff.max())} > {pixel_atol}"
                    )

        verify["ok"] = len(verify["errors"]) == 0
        verify["layer_count"] = len(layers)
        verify["canvas"] = [again.width, again.height]
        verify["names"] = names
    except Exception as e:  # pragma: no cover
        verify["errors"].append(str(e))
    return verify


def export_psd(
    job: Path,
    *,
    revision_id: str = "original",
    out_name: str | None = None,
    skip_empty: bool = False,
    alpha_threshold: int = 10,
    strict_pixels: bool = True,
) -> dict:
    job = job.resolve()
    rev_slug = "original" if revision_id in (None, "", "original") else validate_revision_id(revision_id)
    # also reject weird parent-like values early
    if rev_slug != "original":
        validate_parent_id(rev_slug)

    manifest, pixel_root = load_resolved_manifest(job, rev_slug)
    parts = [L for L in (manifest.get("layers") or []) if L.get("kind", "part") == "part"]
    if not parts:
        raise SystemExit("no part layers to export")

    frame = manifest.get("frame") or {}
    w = int(frame.get("width") or 1024)
    h = int(frame.get("height") or 1024)

    exports = job / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = exports / (out_name or f"export-{rev_slug}-{stamp}.psd")

    ordered = sorted(parts, key=lambda L: (L.get("order", 0), L.get("id") or ""))
    psd = PSDImage.new(mode="RGBA", size=(w, h), depth=8)
    written: list[dict] = []
    expected_images: list[Image.Image] = []

    for layer in ordered:
        # Keep stable id through export metadata
        layer_id = str(layer.get("id") or "")
        img_path = resolve_layer_image(pixel_root, job, layer)
        im = Image.open(img_path).convert("RGBA")
        if im.size != (w, h):
            canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            bbox = layer.get("bbox")
            if isinstance(bbox, (list, tuple)) and len(bbox) == 4:
                x1, y1, x2, y2 = [int(v) for v in bbox]
                if im.size == (x2 - x1, y2 - y1):
                    canvas.paste(im, (x1, y1), im)
                else:
                    canvas.paste(im, (x1, y1), im)
            else:
                canvas.paste(im, (0, 0), im)
            im = canvas

        if skip_empty:
            alpha = im.getchannel("A")
            if not any(px > alpha_threshold for px in alpha.getdata()):
                continue

        opacity_i = _opacity_byte(layer.get("opacity", 1))
        name = str(layer.get("name") or layer.get("id") or "layer")
        visible = layer.get("visible", True) is not False
        pl = psd.create_pixel_layer(im, name=name, top=0, left=0, opacity=opacity_i)
        pl.visible = visible
        written.append(
            {
                "id": layer_id,
                "name": name,
                "order": layer.get("order"),
                "opacity": opacity_i,
                "visible": visible,
                "source": str(img_path.relative_to(job)).replace("\\", "/"),
            }
        )
        expected_images.append(im.copy())

    if not written:
        raise SystemExit("no layers written (all empty?)")

    # utf-8 keeps CJK layer names; macroman (psd_tools default) cannot
    psd.save(out_path, encoding="utf-8")

    verify = verify_exported_psd(
        out_path,
        written=written,
        expected_images=expected_images,
        canvas=(w, h),
        pixel_atol=0 if strict_pixels else 1,
    )

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
            "psd_tools round-trip != Cubism Editor acceptance.",
        ],
    }
    report_path = exports / f"{out_path.stem}.export.json"
    write_json(report_path, report)
    print(
        json.dumps(
            {
                "psd": str(out_path),
                "verify_ok": verify["ok"],
                "layers": len(written),
                "revision_id": rev_slug,
            },
            ensure_ascii=False,
        )
    )
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
    parser.add_argument("--no-strict-pixels", action="store_true")
    args = parser.parse_args()
    try:
        export_psd(
            args.job,
            revision_id=args.revision,
            out_name=args.out_name,
            skip_empty=args.skip_empty,
            strict_pixels=not args.no_strict_pixels,
        )
    except RevisionError as e:
        raise SystemExit(str(e)) from e


if __name__ == "__main__":
    main()
