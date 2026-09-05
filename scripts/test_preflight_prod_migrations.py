import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("preflight-prod-migrations.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class MigrationHistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "1_initial.sql"
        self.path.write_bytes(b"SELECT 1;\n")
        self.applied = {"version": 1, "success": True,
                        "checksum": hashlib.sha384(self.path.read_bytes()).hexdigest()}

    def test_only_unapplied_migrations_are_rehearsed_in_version_order(self):
        files = {3: Path("third.sql"), 1: self.path, 2: Path("second.sql")}
        self.assertEqual(preflight.verify_history([self.applied], files),
                         [(2, files[2]), (3, files[3])])

    def test_changed_applied_sql_blocks_upgrade(self):
        self.path.write_bytes(b"SELECT 2;\n")
        with self.assertRaisesRegex(RuntimeError, "checksum differs"):
            preflight.verify_history([self.applied], {1: self.path})

    def test_unknown_or_failed_migrations_block_upgrade(self):
        for row, files in [(self.applied, {}),
                           ({**self.applied, "success": False}, {1: self.path})]:
            with self.subTest(row=row, files=files), self.assertRaisesRegex(RuntimeError, "Unknown or failed"):
                preflight.verify_history([row], files)


if __name__ == "__main__":
    unittest.main()
