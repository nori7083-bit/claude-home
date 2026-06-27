import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "slide_generator.py"


class SlideGeneratorTests(unittest.TestCase):
    def test_generate_html_from_markdown(self):
        markdown = "# Title\n\nHello world\n\n---\n\n## Agenda\n\n- Point 1\n- Point 2"

        result = subprocess.run(
            [sys.executable, str(SCRIPT), "-"],
            input=markdown,
            text=True,
            capture_output=True,
            check=True,
        )

        self.assertIn("<section class=\"slide\">", result.stdout)
        self.assertIn("<h1>Title</h1>", result.stdout)
        self.assertIn("<h2>Agenda</h2>", result.stdout)
        self.assertIn("<li>Point 1</li>", result.stdout)

    def test_cli_writes_output_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            input_path = Path(tmp_dir) / "deck.md"
            output_path = Path(tmp_dir) / "deck.html"
            input_path.write_text("# Demo\n\nContent\n\n---\n\n## Next\n\nMore", encoding="utf-8")

            subprocess.run(
                [sys.executable, str(SCRIPT), str(input_path), str(output_path)],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertTrue(output_path.exists())
            html = output_path.read_text(encoding="utf-8")
            self.assertIn("<title>Demo</title>", html)
            self.assertIn("<section class=\"slide\">", html)


if __name__ == "__main__":
    unittest.main()
