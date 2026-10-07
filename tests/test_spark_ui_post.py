"""Build and check the post: python3 -m unittest discover -s tests."""

from html import unescape
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
SLUG = "reading-the-spark-ui-from-notebook-cell-to-task"
POST = ROOT / "content/posts" / f"2026-10-07-{SLUG}.md"
URL = f"/posts/{SLUG}/"


class SparkUiPostTest(unittest.TestCase):
    def test_published_post(self):
        subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
        source = POST.read_text()
        front_matter = source.split("---", 2)[1]
        for field in (
            'title: "Reading the Spark UI: from notebook cell to task"',
            "author: thibauldc",
            "date: 2026-10-07 19:00:00",
            "categories: [Microsoft Fabric, Spark]",
            "tags: [spark, fabric, spark-ui, performance]",
        ):
            self.assertIn(field, front_matter)

        page = (ROOT / "_site" / URL.strip("/") / "index.html").read_text()
        self.assertIn("<h1>Reading the Spark UI: from notebook cell to task</h1>", page)
        self.assertIn('<time datetime="2026-10-07">', page)
        diagrams = re.findall(r"```mermaid\n(.*?)```", source, re.S)
        rendered = re.findall(r'<pre class="mermaid">(.*?)</pre>', page, re.S)
        self.assertGreaterEqual(len(diagrams), 2)
        self.assertEqual([unescape(diagram) for diagram in rendered], diagrams)
        for diagram in diagrams:
            self.assertIn("accTitle:", diagram)
            self.assertIn("accDescr:", diagram)
        self.assertIn("mermaid.initialize({ startOnLoad: false", page)
        self.assertIn("await mermaid.run();", page)

        images = re.findall(r'<img src="([^"]+)" alt="([^"]+)"', page)
        self.assertEqual(
            {src for src, _ in images},
            {"/images/spark_ui_jobs.png", "/images/application_detail_monitoring.png"},
        )
        for src, alt in images:
            self.assertTrue(alt.strip())
            original = (ROOT / "public" / src.lstrip("/")).read_bytes()
            self.assertTrue(original.startswith(b"\x89PNG\r\n\x1a\n"))
            self.assertEqual((ROOT / "_site" / src.lstrip("/")).read_bytes(), original)

        for listing in ("index.html", "posts/index.html", "tags/index.html"):
            self.assertIn(f'href="{URL}"', (ROOT / "_site" / listing).read_text())
        self.assertIn("The Spark detective's field guide", source)
        self.assertNotRegex(source, r"\[The Spark detective's field guide\]\(")
        self.assertNotRegex(source, r"(?i)EMFCC26|recording notice|audience question")


if __name__ == "__main__":
    unittest.main()
