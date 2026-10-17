"""Regression tests for a fail-closed, idle/flat evidence-publication repair.

All broker and task operations are mocked. No MT5 order calls or scheduled
tasks are made by these tests.
"""
import hashlib
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import apply_preflight_publication as installer


def sha(value):
    return hashlib.sha256(value).hexdigest()


OLD = b"def publish():\n  self._preflight_evidence=None\n  return True\n"
NEW = OLD.replace(installer.REMOVED, installer.ADDED)


class PublicationInstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.readonly = self.root / "read_only"
        self.readonly.mkdir()
        self.target = self.root / "v51_dashboard_runtime.py"
        self.package = self.root / "v51_dashboard_runtime.patch.py"
        self.fp = self.readonly / "demo_engine_fingerprint.json"
        self.db = self.readonly / "demo_bridge.sqlite3"
        self.target.write_bytes(OLD)
        self.package.write_bytes(NEW)
        self.manifest = {
            "skillHash": installer.SKILL_HASH,
            "files": {"v51_dashboard_runtime.py": sha(OLD)}
        }
        self.fp.write_text(json.dumps(self.manifest), encoding="utf-8")
        connection = sqlite3.connect(self.db)
        connection.execute("create table active_run (singleton integer, request_id text)")
        connection.execute("insert into active_run values (1, null)")
        connection.execute("create table receipts (status text)")
        connection.commit()
        connection.close()
        self.patches = [
            patch.object(installer, "ROOT", self.root),
            patch.object(installer, "TARGET", self.target),
            patch.object(installer, "PACKAGE", self.package),
            patch.object(installer, "FINGERPRINT", self.fp),
            patch.object(installer, "DATABASE", self.db),
            patch.object(installer, "OLD_HASH", sha(OLD)),
            patch.object(installer, "NEW_HASH", sha(NEW)),
            patch.object(installer, "OLD_FINGERPRINT_HASH", sha(self.fp.read_bytes())),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_pinned_change_is_exactly_one_evidence_reset_removal(self):
        state, before, after = installer.source_check()
        self.assertEqual(state, "patch_ready")
        self.assertEqual(before.replace(installer.REMOVED, installer.ADDED), after)
        self.assertEqual(sha(before), installer.OLD_HASH)
        self.assertEqual(sha(after), installer.NEW_HASH)

    def test_package_changes_are_rejected_even_if_new_hash_is_updated(self):
        extra = NEW + b"\nTRADING_GUARD_DISABLED = True\n"
        self.package.write_bytes(extra)
        with patch.object(installer, "NEW_HASH", sha(extra)):
            with self.assertRaisesRegex(ValueError, "UNEXPECTED_SOURCE_DIFF"):
                installer.source_check()

    def test_modified_old_engine_is_rejected(self):
        self.target.write_bytes(OLD + b"# unreviewed edit\n")
        with self.assertRaisesRegex(ValueError, "UNPINNED_ENGINE_SOURCE"):
            installer.source_check()

    def test_modified_skill_manifest_is_rejected(self):
        self.manifest["skillHash"] = "wrong"
        self.fp.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, "UNAPPROVED_SKILL_FINGERPRINT"):
            installer.fingerprint_check()

    def test_installed_version_is_idempotent_only_with_updated_fingerprint(self):
        self.target.write_bytes(NEW)
        status, _, _ = installer.source_check()
        self.assertEqual(status, "already_installed")
        with patch.object(installer, "broker_flat"):
            with self.assertRaisesRegex(ValueError, "INSTALLED_SOURCE_NOT_FINGERPRINTED"):
                installer.validate()

    def test_active_run_blocks_update(self):
        db = sqlite3.connect(self.db)
        db.execute("update active_run set request_id='uncleared-cycle'")
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, "ACTIVE_RUN_PRESENT"):
            installer.no_active_run()

    def test_unsettled_receipt_blocks_update(self):
        db = sqlite3.connect(self.db)
        db.execute("insert into receipts values ('UNCERTAIN')")
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, "UNSETTLED_CONTROL_RECEIPT"):
            installer.no_active_run()

    def test_check_checks_broker_flat_but_never_modifies_files(self):
        original_source = self.target.read_bytes()
        original_fingerprint = self.fp.read_bytes()
        with patch.object(installer, "broker_flat", return_value=None) as verify:
            status, _, _, _, _ = installer.validate()
            self.assertEqual(status, "patch_ready")
            verify.assert_called_once_with()
        self.assertEqual(self.target.read_bytes(), original_source)
        self.assertEqual(self.fp.read_bytes(), original_fingerprint)

    def test_broker_flat_failure_stops_check_without_writing(self):
        with patch.object(installer, "broker_flat", side_effect=ValueError("BROKER_HAS_POSITIONS_OR_ORDERS")):
            with self.assertRaisesRegex(ValueError, "BROKER_HAS_POSITIONS_OR_ORDERS"):
                installer.validate()
        self.assertEqual(self.target.read_bytes(), OLD)
        self.assertEqual(self.manifest, json.loads(self.fp.read_text()))


if __name__ == "__main__":
    unittest.main()
