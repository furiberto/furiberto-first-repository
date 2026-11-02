"""Resolve layer asset paths inside a job sandbox (no absolute / traversal / symlink escape)."""

from __future__ import annotations

from pathlib import Path


class PathSafetyError(ValueError):
    """Layer file path escapes the allowed job directories."""


def _is_under(child: Path, root: Path) -> bool:
    try:
        child.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def assert_relative_manifest_path(rel: str, *, layer_id: str | None = None) -> str:
    """Manifest `file` must be a relative POSIX-ish path with no absolute or `..` segments."""
    raw = str(rel or "").strip().replace("\\", "/")
    label = f"layer {layer_id}" if layer_id else "path"
    if not raw:
        raise PathSafetyError(f"{label}: empty file path")
    p = Path(raw)
    if p.is_absolute() or raw.startswith("/") or (len(raw) >= 2 and raw[1] == ":"):
        raise PathSafetyError(f"{label}: absolute paths are forbidden: {raw!r}")
    parts = [x for x in raw.split("/") if x not in ("", ".")]
    if any(part == ".." for part in parts):
        raise PathSafetyError(f"{label}: path traversal forbidden: {raw!r}")
    if raw.startswith("~"):
        raise PathSafetyError(f"{label}: home-relative paths forbidden: {raw!r}")
    return "/".join(parts)


def resolve_under_allowed(rel: str, *allowed_roots: Path, layer_id: str | None = None) -> Path:
    """
    Join relative path under each allowed root; return the first existing file whose
    resolved real path stays inside that root (blocks symlink escape).
    """
    safe_rel = assert_relative_manifest_path(rel, layer_id=layer_id)
    tried: list[str] = []
    for root in allowed_roots:
        if root is None:
            continue
        root = Path(root)
        if not root.exists():
            continue
        candidate = (root / safe_rel)
        tried.append(str(candidate))
        if not candidate.exists():
            # Also try basename-only under root (legacy)
            alt = root / Path(safe_rel).name
            if alt.exists() and alt.is_file():
                candidate = alt
            else:
                continue
        if not candidate.is_file() and not candidate.is_symlink():
            continue
        # Follow symlinks via resolve(); require final path under the same root.
        try:
            real = candidate.resolve(strict=True)
        except FileNotFoundError as e:
            raise PathSafetyError(f"layer {layer_id}: broken path {candidate}") from e
        if not _is_under(real, root):
            raise PathSafetyError(
                f"layer {layer_id}: resolved path escapes sandbox "
                f"({real} not under {root.resolve()})"
            )
        if not real.is_file():
            raise PathSafetyError(f"layer {layer_id}: not a file after resolve: {real}")
        return real
    raise PathSafetyError(
        f"layer {layer_id}: file not found for {safe_rel!r} (tried {tried[:4]})"
    )
