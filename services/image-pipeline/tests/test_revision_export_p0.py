#!/usr/bin/env python3
"""P0 reliability tests for revision_ops + export_psd. Run against a job fixture."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import tempfile
import traceback
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "adapter"
sys.path.insert(0, str(ADAPTER))

from export_psd import export_psd  # noqa: E402
from revision_ops import RevisionError, apply_operations, create_revision, read_json  # noqa: E402

SOURCE_JOB = ROOT / "workspace" / "jobs" / "phase2-ingest-test"


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def snapshot_decomposition(job: Path) -> dict[str, str]:
    decomp = job / "decomposition"
    out = {}
    for p in sorted(decomp.rglob("*")):
        if p.is_file():
            out[str(p.relative_to(decomp)).replace("\\", "/")] = file_sha(p)
    return out


@unittest.skipUnless(SOURCE_JOB.is_dir(), "phase2-ingest-test fixture missing; run ingest first")
class RevisionExportP0Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="p0-rev-"))
        self.job = self.tmp / "job"
        shutil.copytree(SOURCE_JOB, self.job)
        # Drop previous revisions/exports from fixture so tests are deterministic
        for name in ("revisions", "exports"):
            p = self.job / name
            if p.exists():
                shutil.rmtree(p)
        (self.job / "exports").mkdir(parents=True, exist_ok=True)
        (self.job / "revisions").mkdir(parents=True, exist_ok=True)
        self.before = snapshot_decomposition(self.job)
        job_json = self.job / "job.json"
        if job_json.is_file():
            data = read_json(job_json)
            data["live2d_ready"] = False
            data.pop("activeRevision", None)
            job_json.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_invalid_opacity_rejected_before_dir(self) -> None:
        with self.assertRaises(RevisionError):
            create_revision(
                self.job,
                operations=[{"op": "set_opacity", "layer_id": "face", "value": 1.5}],
                parent_revision_id="original",
            )
        self.assertEqual(list((self.job / "revisions").iterdir()), [])
        self.assertEqual(snapshot_decomposition(self.job), self.before)

    def test_reorder_all_must_be_complete(self) -> None:
        with self.assertRaises(RevisionError):
            create_revision(
                self.job,
                operations=[{"op": "reorder_all", "order": ["face", "face"]}],
                parent_revision_id="original",
            )
        self.assertEqual(list((self.job / "revisions").iterdir()), [])

    def test_path_traversal_parent_rejected(self) -> None:
        with self.assertRaises(RevisionError):
            create_revision(
                self.job,
                operations=[{"op": "rename", "layer_id": "face", "value": "脸"}],
                parent_revision_id="../original",
            )

    def test_structure_ops_and_export_roundtrip(self) -> None:
        man = read_json(self.job / "decomposition" / "layer-manifest.json")
        part_ids = [L["id"] for L in man["layers"] if L.get("kind") == "part"]
        # Put face first
        order = ["face"] + [i for i in part_ids if i != "face"]
        meta = create_revision(
            self.job,
            operations=[
                {"op": "rename", "layer_id": "back-hair", "value": "后发"},
                {"op": "set_opacity", "layer_id": "face", "value": 0.85},
                {"op": "set_visible", "layer_id": "objects", "value": False},
                {"op": "reorder_all", "order": order},
            ],
            parent_revision_id="original",
            label="p0-struct",
        )
        rid = meta["revision_id"]
        self.assertRegex(rid, r"^revision-\d{3}$")
        self.assertEqual(snapshot_decomposition(self.job), self.before)

        rev_man = read_json(self.job / "revisions" / rid / "layer-manifest.json")
        by_id = {L["id"]: L for L in rev_man["layers"]}
        self.assertEqual(by_id["back-hair"]["name"], "后发")
        self.assertEqual(by_id["face"]["opacity"], 0.85)
        self.assertIs(by_id["objects"]["visible"], False)
        # densified: face order 0
        self.assertEqual(by_id["face"]["order"], 0)
        # original English name still in decomposition
        orig = read_json(self.job / "decomposition" / "layer-manifest.json")
        orig_by = {L["id"]: L for L in orig["layers"]}
        self.assertEqual(orig_by["back-hair"]["name"], "back hair")

        report = export_psd(self.job, revision_id=rid, out_name="p0-rev.psd")
        self.assertTrue(report["verify"]["ok"], report["verify"])
        # first layer should be face after reorder_all
        self.assertEqual(report["layers"][0]["id"], "face")
        face_meta = next(L for L in report["layers"] if L["id"] == "face")
        self.assertEqual(face_meta["opacity"], 217)
        objects = next(L for L in report["layers"] if L["id"] == "objects")
        self.assertFalse(objects["visible"])
        back = next(L for L in report["layers"] if L["id"] == "back-hair")
        self.assertEqual(back["name"], "后发")

        job_data = read_json(self.job / "job.json")
        self.assertFalse(job_data.get("live2d_ready", False))

    def test_version_branch_independence(self) -> None:
        part_ids = [
            L["id"]
            for L in read_json(self.job / "decomposition" / "layer-manifest.json")["layers"]
            if L.get("kind") == "part"
        ]
        a = create_revision(
            self.job,
            operations=[{"op": "rename", "layer_id": "face", "value": "A-face"}],
            parent_revision_id="original",
            label="A",
        )
        a_id = a["revision_id"]
        b = create_revision(
            self.job,
            operations=[{"op": "rename", "layer_id": "face", "value": "B-face"}],
            parent_revision_id=a_id,
            label="B",
        )
        b_id = b["revision_id"]
        c = create_revision(
            self.job,
            operations=[
                {"op": "rename", "layer_id": "face", "value": "C-face"},
                {"op": "set_opacity", "layer_id": "face", "value": 0.5},
            ],
            parent_revision_id=a_id,
            label="C",
        )
        c_id = c["revision_id"]

        self.assertEqual(b["parent_revision_id"], a_id)
        self.assertEqual(c["parent_revision_id"], a_id)

        man_b = read_json(self.job / "revisions" / b_id / "layer-manifest.json")
        man_c = read_json(self.job / "revisions" / c_id / "layer-manifest.json")
        face_b = next(L for L in man_b["layers"] if L["id"] == "face")
        face_c = next(L for L in man_c["layers"] if L["id"] == "face")
        self.assertEqual(face_b["name"], "B-face")
        self.assertEqual(face_c["name"], "C-face")
        self.assertEqual(face_c["opacity"], 0.5)
        self.assertNotEqual(face_b.get("opacity", 1), 0.5)

        exp_b = export_psd(self.job, revision_id=b_id, out_name="branch-b.psd")
        exp_c = export_psd(self.job, revision_id=c_id, out_name="branch-c.psd")
        self.assertTrue(exp_b["verify"]["ok"], exp_b["verify"])
        self.assertTrue(exp_c["verify"]["ok"], exp_c["verify"])
        name_b = next(L for L in exp_b["layers"] if L["id"] == "face")["name"]
        name_c = next(L for L in exp_c["layers"] if L["id"] == "face")["name"]
        op_c = next(L for L in exp_c["layers"] if L["id"] == "face")["opacity"]
        self.assertEqual(name_b, "B-face")
        self.assertEqual(name_c, "C-face")
        self.assertEqual(op_c, 128)
        # B unchanged after exporting C
        man_b2 = read_json(self.job / "revisions" / b_id / "layer-manifest.json")
        self.assertEqual(next(L for L in man_b2["layers"] if L["id"] == "face")["name"], "B-face")
        self.assertEqual(snapshot_decomposition(self.job), self.before)
        self.assertGreaterEqual(len(part_ids), 3)

    def test_original_still_exports(self) -> None:
        report = export_psd(self.job, revision_id="original", out_name="original.psd")
        self.assertTrue(report["verify"]["ok"], report["verify"])
        self.assertEqual(report["revision_id"], "original")
        self.assertEqual(len(report["layers"]), 24)
        self.assertEqual(snapshot_decomposition(self.job), self.before)

    def test_stable_layer_id_preserved(self) -> None:
        man = read_json(self.job / "decomposition" / "layer-manifest.json")
        resolved = apply_operations(
            man,
            [{"op": "rename", "layer_id": "front-hair", "value": "前发"}],
        )
        ids_before = [L["id"] for L in man["layers"] if L.get("kind") == "part"]
        ids_after = [L["id"] for L in resolved["layers"] if L.get("kind") == "part"]
        self.assertEqual(ids_before, ids_after)


def main() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(RevisionExportP0Tests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        for test, err in result.failures + result.errors:
            print("FAIL", test)
            print(err)
        return 1
    print("P0_TESTS_OK", f"ran={result.testsRun}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
