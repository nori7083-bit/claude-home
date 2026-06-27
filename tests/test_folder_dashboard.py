import os
import tempfile
import time
import unittest
from pathlib import Path

from folder_dashboard import render_dashboard, scan_directory


class FolderDashboardTests(unittest.TestCase):
    def test_scan_directory_lists_directories_and_files(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            docs_dir = root / "Documents"
            docs_dir.mkdir()
            (docs_dir / "notes.txt").write_text("hello", encoding="utf-8")
            (docs_dir / "Projects").mkdir()

            inventory = scan_directory(root, max_depth=2)

            self.assertEqual(inventory["name"], root.name)
            self.assertTrue(any(item["name"] == "Documents" for item in inventory["children"]))
            self.assertTrue(any(item["name"] == "notes.txt" for item in inventory["children"][0]["children"]))

    def test_render_dashboard_includes_sources_and_items(self):
        inventory = [
            {
                "name": "PC",
                "path": "/Users/example/Work",
                "children": [
                    {"name": "Documents", "path": "/Users/example/Work/Documents", "type": "directory", "size": 0, "children": []}
                ],
            }
        ]

        html = render_dashboard(inventory)

        self.assertIn("Folder Inventory Dashboard", html)
        self.assertIn("PC", html)
        self.assertIn("Documents", html)

    def test_render_dashboard_color_codes_old_items(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            old_file = root / "old.txt"
            old_file.write_text("old", encoding="utf-8")
            old_time = time.time() - 40 * 24 * 3600
            os.utime(old_file, (old_time, old_time))

            inventory = scan_directory(root, max_depth=1)
            html = render_dashboard(inventory)

            self.assertIn("age-old", html)
            self.assertIn("old.txt", html)


if __name__ == "__main__":
    unittest.main()
