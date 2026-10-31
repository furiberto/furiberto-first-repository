#!/usr/bin/env python3
"""Ingest a See-through phase0 output folder into an Electron job directory."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from normalize_layers import discover_upstream_dir, normalize_from_upstream


def ensure_job_tree(out: Path) -> dict[str, Path]:
    paths = {
        "root": out,
        "source": out / "source",
        "decomposition": out / "decomposition",
        "layers": out / "decomposition" / "layers",
        "masks": out / "decomposition" / "masks",
        "depth": out / "decomposition" / "depth",
        "exports": out / "exports",
        "logs": out / "logs",
        "revisions": out / "revisions",
        "upstream": out / "decomposition" / "upstream",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, type=Path, help="phase0 first-run dir")
    parser.add_argument("--out", required=True, type=Path, help="job output dir")
    args = parser.parse_args()

    src = args.src.resolve()
    out = args.out.resolve()
    paths = ensure_job_tree(out)

    stem = discover_upstream_dir(src)
    if stem is None:
        raise SystemExit(f"no info.json / part folder under {src}")

    # Copy raw upstream for traceability
    dest_up = paths["upstream"] / stem.name
    if dest_up.exists():
        shutil.rmtree(dest_up)
    shutil.copytree(stem, dest_up)

    # Source preview
    for name in ("src_img.png", "reconstruction.png"):
        cand = stem / name
        if cand.is_file():
            shutil.copy2(cand, paths["source"] / "original.png")
            break
    else:
        # tiny placeholder
        try:
            from PIL import Image

            Image.new("RGBA", (64, 64), (200, 200, 210, 255)).save(
                paths["source"] / "original.png"
            )
        except Exception:
            (paths["source"] / "original.png").write_bytes(b"")

    (paths["source"] / "source.json").write_text(
        json.dumps(
            {"type": "illustration", "ingested_from": str(src), "stored_as": "original.png"},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    # PSD siblings live next to stem in phase0 layout
    for psd in src.glob("*.psd"):
        shutil.copy2(psd, paths["exports"] / psd.name)
        shutil.copy2(psd, paths["decomposition"] / psd.name)

    layers, psd_rel = normalize_from_upstream(
        dest_up,
        paths,
        input_path=paths["source"] / "original.png",
        backend="see-through-quantized",
    )
    # Prefer exports relative path
    if not psd_rel:
        for psd in sorted(paths["exports"].glob("*.psd")):
            if "depth" not in psd.name.lower():
                psd_rel = f"exports/{psd.name}"
                break

    job_path = out / "job.json"
    job = {}
    if job_path.is_file():
        job = json.loads(job_path.read_text(encoding="utf-8-sig"))
    job.update(
        {
            "status": "needs_review",
            "phase": "needs_review",
            "resultKind": "decomposition",
            "live2d_ready": False,
            "sourceName": job.get("sourceName") or "source.png",
            "artifacts": [
                a
                for a in [
                    psd_rel,
                    "decomposition/layer-manifest.json",
                    "source/original.png",
                ]
                if a
            ],
            "message": "已规范化 See-through 图层，可审阅（非 Live2D）",
            "error": None,
        }
    )
    # Also place top-level source.png for Electron createPlaceholder compatibility
    src_png = paths["source"] / "original.png"
    if src_png.is_file():
        shutil.copy2(src_png, out / "source.png")
        job["sourceName"] = "source.png"

    job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    part_n = sum(1 for L in layers if L.get("kind") == "part")
    print(f"[ingest] OK parts={part_n} psd={psd_rel} → {out}")


if __name__ == "__main__":
    main()
