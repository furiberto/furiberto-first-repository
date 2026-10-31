"""Minimal layer-manifest helpers for Phase 0/1."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def build_manifest(
    *,
    input_path: Path,
    layers: list[dict[str, Any]] | None = None,
    psd: str | None = None,
    backend: str = "dry-run",
    pipeline_version: str = "unspecified",
    model_version: str = "unspecified",
    notes: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "pipeline": "see-through",
        "pipeline_version": pipeline_version,
        "model_version": model_version,
        "backend": backend,
        "input_hash": sha256_file(input_path) if input_path.is_file() else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "layers": layers or [],
        "psd": psd,
        "notes": notes or [],
    }


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
