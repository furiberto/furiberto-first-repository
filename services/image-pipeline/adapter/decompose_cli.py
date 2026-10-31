#!/usr/bin/env python3
"""
Phase 0/1 CLI: prepare job dirs and optionally invoke See-through.

Never claims Live2D / .moc3 success. Outputs decomposition artifacts + manifest only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from layer_manifest import build_manifest, write_manifest
from normalize_layers import discover_upstream_dir, normalize_from_upstream

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VENDOR = ROOT / "vendor" / "see-through"
DEFAULT_MODELS = ROOT / "workspace" / "models"
LOCAL_LAYERDIFF = DEFAULT_MODELS / "seethroughv0.0.2_layerdiff3d_nf4"
LOCAL_DEPTH = DEFAULT_MODELS / "seethroughv0.0.1_marigold_nf4"


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


def copy_source(image: Path, source_dir: Path) -> Path:
    ext = image.suffix.lower() or ".png"
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise SystemExit(f"unsupported image type: {ext}")
    dest_name = f"original{ext if ext != '.jpeg' else '.jpg'}"
    dest = source_dir / dest_name
    shutil.copy2(image, dest)
    meta = {
        "type": "illustration",
        "original_name": image.name,
        "stored_as": dest_name,
    }
    (source_dir / "source.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return dest


def resolve_see_through_root() -> Path:
    env = os.environ.get("SEE_THROUGH_ROOT", "").strip()
    root = Path(env) if env else DEFAULT_VENDOR
    return root.resolve()


def resolve_local_repo(cli_value: str | None, local_default: Path) -> str | None:
    if cli_value:
        return str(Path(cli_value).resolve())
    if local_default.is_dir() and any(local_default.iterdir()):
        return str(local_default.resolve())
    return None


def run_see_through_quantized(
    image: Path,
    paths: dict[str, Path],
    resolution: int,
    *,
    no_group_offload: bool,
    repo_layerdiff: str | None,
    repo_depth: str | None,
) -> Path:
    """Invoke upstream quantized script; return save_dir with PSD/outputs."""
    st = resolve_see_through_root()
    script = st / "inference" / "scripts" / "inference_psd_quantized.py"
    if not script.is_file():
        raise SystemExit(
            f"See-through not found at {st}. Run scripts/setup-see-through.ps1 first."
        )

    save_dir = paths["upstream"]
    cmd = [
        sys.executable,
        str(script),
        "--srcp",
        str(image.resolve()),
        "--save_to_psd",
        "--resolution",
        str(resolution),
        "--save_dir",
        str(save_dir),
    ]
    if no_group_offload:
        cmd.append("--no_group_offload")
    if repo_layerdiff:
        cmd.extend(["--repo_id_layerdiff", repo_layerdiff])
    if repo_depth:
        cmd.extend(["--repo_id_depth", repo_depth])

    log_path = paths["logs"] / "pipeline.log"
    print("[decompose] running:", " ".join(cmd), flush=True)
    print(f"[decompose] cwd={st}", flush=True)
    with log_path.open("w", encoding="utf-8") as log:
        log.write("command: " + " ".join(cmd) + "\n")
        proc = subprocess.run(
            cmd,
            cwd=str(st),
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
        log.write(f"\nexit_code={proc.returncode}\n")
    if proc.returncode != 0:
        raise SystemExit(
            f"See-through failed (exit {proc.returncode}). See {log_path}"
        )
    return save_dir


def collect_outputs(
    upstream_out: Path,
    paths: dict[str, Path],
    *,
    input_path: Path | None = None,
) -> tuple[list[dict], str | None]:
    """Normalize See-through save_dir into decomposition/layers + manifest."""
    if not upstream_out.is_dir():
        return [], None
    stem_dir = discover_upstream_dir(upstream_out) or discover_upstream_dir(upstream_out.parent)
    if stem_dir is None:
        # Flat save_dir without nested stem folder
        stem_dir = upstream_out
    return normalize_from_upstream(
        stem_dir,
        paths,
        input_path=input_path,
        backend="see-through-quantized",
    )


def write_job_stub(
    out: Path,
    *,
    phase: str,
    message: str,
    result_kind: str,
    artifacts: list[str] | None = None,
) -> None:
    existing: dict = {}
    job_path = out / "job.json"
    if job_path.is_file():
        try:
            existing = json.loads(job_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            existing = {}

    status = "needs_review" if phase == "needs_review" else existing.get("status", "queued")
    if phase == "preprocessing":
        status = existing.get("status", "queued")
    if phase == "failed":
        status = "failed"

    job = {
        **existing,
        "status": status,
        "phase": phase,
        "resultKind": result_kind,
        "message": message,
        "live2d_ready": False,
        "error": None if phase != "failed" else existing.get("error"),
    }
    # Never drop Electron identity fields even if a partial stub raced
    for key in (
        "id",
        "sourceName",
        "sourceType",
        "displayName",
        "createdAt",
        "characterId",
        "updatedAt",
    ):
        if key in existing and key not in job:
            job[key] = existing[key]
    if artifacts is not None:
        job["artifacts"] = artifacts
    job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="AI-assisted layer decomposition adapter")
    parser.add_argument("--image", required=True, type=Path, help="Input illustration")
    parser.add_argument("--out", required=True, type=Path, help="Job output directory")
    parser.add_argument(
        "--backend",
        choices=("dry-run", "see-through-quantized"),
        default="dry-run",
    )
    parser.add_argument("--resolution", type=int, default=1024, help="For 8GB VRAM default 1024")
    parser.add_argument(
        "--group-offload",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Upstream group_offload (default off: needed on some 8GB + bnb stacks)",
    )
    parser.add_argument("--repo-id-layerdiff", default=None)
    parser.add_argument("--repo-id-depth", default=None)
    args = parser.parse_args()

    image = args.image.resolve()
    if not image.is_file():
        raise SystemExit(f"image not found: {image}")

    out = args.out.resolve()
    paths = ensure_job_tree(out)
    stored = copy_source(image, paths["source"])

    notes = [
        "Decomposition only — not Live2D / .moc3.",
        "Human review + Cubism Editor rigging required before desktop pet playback.",
    ]

    if args.backend == "dry-run":
        notes.append("dry-run: directory scaffold only; no GPU inference.")
        manifest = build_manifest(
            input_path=stored,
            backend="dry-run",
            notes=notes,
        )
        write_manifest(paths["decomposition"] / "layer-manifest.json", manifest)
        write_job_stub(
            out,
            phase="preprocessing",
            message="Dry-run scaffold ready. Re-run with --backend see-through-quantized for PSD.",
            result_kind="dry-run",
            artifacts=["source/", "decomposition/layer-manifest.json"],
        )
        print(f"[decompose] dry-run OK → {out}")
        return

    repo_ld = resolve_local_repo(args.repo_id_layerdiff, LOCAL_LAYERDIFF)
    repo_dp = resolve_local_repo(args.repo_id_depth, LOCAL_DEPTH)
    if repo_ld:
        print(f"[decompose] layerdiff repo={repo_ld}", flush=True)
    if repo_dp:
        print(f"[decompose] depth repo={repo_dp}", flush=True)

    upstream = run_see_through_quantized(
        stored,
        paths,
        args.resolution,
        no_group_offload=not args.group_offload,
        repo_layerdiff=repo_ld,
        repo_depth=repo_dp,
    )
    layers, psd_rel = collect_outputs(upstream, paths, input_path=stored)
    part_layers = [L for L in layers if L.get("kind") == "part"]
    if not part_layers and not psd_rel:
        notes.append(
            f"Warning: no PSD/PNG collected from {upstream}. Check logs/pipeline.log."
        )
    artifacts = ["decomposition/layer-manifest.json", "logs/pipeline.log"]
    if psd_rel:
        artifacts.insert(0, psd_rel)
    write_job_stub(
        out,
        phase="needs_review",
        message="Layer decomposition finished. Review PSD/layers — Cubism binding next (not auto .moc3).",
        result_kind="decomposition",
        artifacts=artifacts,
    )
    print(f"[decompose] done → {out}")
    print(f"[decompose] layers={len(part_layers)} psd={psd_rel}")


if __name__ == "__main__":
    main()
