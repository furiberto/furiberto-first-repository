#!/usr/bin/env python3
"""P0.1: empty-layer policy, path sandbox, strict opacity. No Cubism claims."""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "adapter"
sys.path.insert(0, str(ADAPTER))

from export_psd import export_psd, is_fully_transparent  # noqa: E402
from path_safety import PathSafetyError, assert_relative_manifest_path, resolve_under_allowed  # noqa: E402
from revision_ops import RevisionError, create_revision, parse_opacity, read_json  # noqa: E402
from PIL import Image  # noqa: E402

SOURCE_JOB = ROOT / "workspace" / "jobs" / "phase2-ingest-test"


@unittest.skipUnless(SOURCE_JOB.is_dir(), "phase2-ingest-test fixture missing")
class P01SafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="p01-"))
        self.job = self.tmp / "job"
        shutil.copytree(SOURCE_JOB, self.job)
        for name in ("revisions", "exports"):
            p = self.job / name
            if p.exists():
                shutil.rmtree(p)
        (self.job / "exports").mkdir(parents=True, exist_ok=True)
        (self.job / "revisions").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _count_empty_parts(self) -> tuple[int, int]:
        man = read_json(self.job / "decomposition" / "layer-manifest.json")
        parts = [L for L in man["layers"] if L.get("kind") == "part"]
        empty = 0
        for L in parts:
            im = Image.open(self.job / "decomposition" / L["file"]).convert("RGBA")
            if is_fully_transparent(im):
                empty += 1
        return len(parts), empty

    def test_default_keeps_empty_layers(self) -> None:
        total, empty = self._count_empty_parts()
        self.assertGreater(empty, 0, "fixture should contain empty parts")
        report = export_psd(self.job, revision_id="original", out_name="keep-empty.psd", skip_empty=False)
        self.assertTrue(report["verify"]["ok"], report["verify"])
        self.assertFalse(report["skip_empty"])
        self.assertEqual(report["layer_count"], total)
        self.assertEqual(report["skipped_empty"], 0)

    def test_skip_empty_drops_transparent_layers(self) -> None:
        total, empty = self._count_empty_parts()
        report = export_psd(self.job, revision_id="original", out_name="skip-empty.psd", skip_empty=True)
        self.assertTrue(report["verify"]["ok"], report["verify"])
        self.assertTrue(report["skip_empty"])
        self.assertEqual(report["skipped_empty"], empty)
        self.assertEqual(report["layer_count"], total - empty)
        self.assertLess(report["layer_count"], total)
        names = [L["name"] for L in report["layers"]]
        # Non-empty parts from fixture should remain
        self.assertIn("back hair", names)
        self.assertIn("face", names)

    def test_opacity_missing_defaults_to_one(self) -> None:
        self.assertEqual(parse_opacity(None, missing_default=1.0), 1.0)

    def test_opacity_rejects_nan_inf_oob_nonnumeric(self) -> None:
        for bad in (float("nan"), float("inf"), float("-inf"), -0.1, 1.01, "nope", True, {}):
            with self.assertRaises(RevisionError):
                parse_opacity(bad, missing_default=1.0)

    def test_export_rejects_illegal_opacity_without_clamp(self) -> None:
        man_path = self.job / "decomposition" / "layer-manifest.json"
        man = read_json(man_path)
        for L in man["layers"]:
            if L.get("id") == "face":
                L["opacity"] = 9.9  # would have been silently clamped before P0.1
        man_path.write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
        before = list((self.job / "exports").glob("*.psd"))
        with self.assertRaises((RevisionError, SystemExit)):
            export_psd(self.job, revision_id="original", out_name="bad-opacity.psd")
        after = list((self.job / "exports").glob("*.psd"))
        self.assertEqual(before, after, "failed export must not leave a new PSD")

    def test_path_rejects_absolute_and_traversal(self) -> None:
        with self.assertRaises(PathSafetyError):
            assert_relative_manifest_path("C:/Windows/System32/drivers/etc/hosts", layer_id="x")
        with self.assertRaises(PathSafetyError):
            assert_relative_manifest_path("/etc/passwd", layer_id="x")
        with self.assertRaises(PathSafetyError):
            assert_relative_manifest_path("../secrets.png", layer_id="x")
        with self.assertRaises(PathSafetyError):
            assert_relative_manifest_path("layers/../../outside.png", layer_id="x")

    def test_resolve_blocks_symlink_escape(self) -> None:
        if os.name == "nt":
            # Creating symlinks may require admin; skip if PrivilegeError
            try:
                outside = self.tmp / "outside.png"
                Image.new("RGBA", (8, 8), (1, 2, 3, 255)).save(outside)
                link = self.job / "decomposition" / "layers" / "escape-link.png"
                os.symlink(outside, link)
            except OSError as e:
                self.skipTest(f"symlink not permitted: {e}")
        else:
            outside = self.tmp / "outside.png"
            Image.new("RGBA", (8, 8), (1, 2, 3, 255)).save(outside)
            link = self.job / "decomposition" / "layers" / "escape-link.png"
            os.symlink(outside, link)

        with self.assertRaises(PathSafetyError):
            resolve_under_allowed(
                "layers/escape-link.png",
                self.job / "decomposition",
                layer_id="escape",
            )

    def test_export_rejects_traversal_manifest_no_psd(self) -> None:
        man_path = self.job / "decomposition" / "layer-manifest.json"
        man = read_json(man_path)
        for L in man["layers"]:
            if L.get("id") == "face":
                L["file"] = "../job.json"
        man_path.write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
        before = set((self.job / "exports").glob("*"))
        with self.assertRaises(SystemExit):
            export_psd(self.job, revision_id="original", out_name="trav.psd")
        after = set((self.job / "exports").glob("*"))
        self.assertEqual(before, after)

    def test_revision_set_opacity_still_strict(self) -> None:
        with self.assertRaises(RevisionError):
            create_revision(
                self.job,
                operations=[{"op": "set_opacity", "layer_id": "face", "value": float("nan")}],
                parent_revision_id="original",
            )
        self.assertEqual(list((self.job / "revisions").iterdir()), [])


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(P01SafetyTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print("P01_TESTS", f"ran={result.testsRun} ok={result.wasSuccessful()}")
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
