"""Contracts for the chapter-matched, self-contained education documents."""

import contextlib
import io
import sys
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

ASSETS = Path(__file__).resolve().parents[1] / "assets"
sys.path.insert(0, str(ASSETS))

from build_course import COURSE, PRESENTATION, main, render_outputs, validate_links, write_outputs
from course_content import CHAPTERS


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = []
        self.assets = []
        self.chapters = []
        self.links = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "section" and "slide" in attrs.get("class", "").split():
            self.chapters.append(attrs["id"])
        if tag in ("script", "img", "link"):
            source = attrs.get("src", attrs.get("href", ""))
            if source and not source.startswith("data:"):
                self.assets.append(source)
        if tag == "a" and "href" in attrs:
            self.links.append(attrs["href"])


class EducationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = ASSETS.parents[2]
        cls.outputs = render_outputs(cls.root)

    def test_course_and_deck_share_every_chapter_and_anchor(self):
        expected = [chapter["id"] for chapter in CHAPTERS]
        self.assertGreaterEqual(len(expected), 35)
        self.assertEqual(len(expected), len(set(expected)))
        for name in (COURSE, PRESENTATION):
            page = Document(self.outputs[name])
            self.assertEqual(page.chapters, expected)
            self.assertEqual(len(page.ids), len(set(page.ids)))
        deck = Document(self.outputs[PRESENTATION])
        for anchor in expected:
            self.assertIn(f"{COURSE}#{anchor}", deck.links)

    def test_self_contained_pages_and_accessible_progressive_enhancement(self):
        for text in self.outputs.values():
            page = Document(text)
            self.assertEqual(page.assets, [])
            self.assertIn('lang="ko"', text)
            self.assertIn("@media print", text)
            self.assertIn('href="#deck"', text)
            self.assertIn("--accent:#136f57", text)
        deck = self.outputs[PRESENTATION]
        for control in ("previous-slide", "next-slide", "slide-select", "slide-count",
                        "toggle-notes", "toggle-reading", "toggle-fullscreen",
                        "print-slides", "overview"):
            self.assertIn(control, Document(deck).ids)
        self.assertIn("initPresentation(document, window)", deck)
        self.assertNotIn(' hidden', deck.split("<script>")[0])
        self.assertNotIn("initPresentation(document, window)", self.outputs[COURSE])

    def test_trip_pilot_content_and_original_exercises_remain(self):
        text = self.outputs[COURSE]
        for term in ("NLB", "Redis", "pgvector", "embedding_enabled", "Docker",
                     "Cloudflare", "확장 설계", "digest", "app_migrate", "app_user",
                     "concurrency", "sensitive", "terraform test", "mock_provider",
                     "GITHUB_OUTPUT", "OIDC", "--atomic", "30분", "60분", "채점 기준"):
            with self.subTest(term=term):
                self.assertIn(term, text)
        self.assertNotIn("PostGIS", text)
        self.assertNotIn("scene-api", text)
        self.assertGreaterEqual(text.count("<pre>"), 25)
        self.assertGreaterEqual(text.count("<details"), 15)

    def test_chapters_have_summary_notes_and_verified_source_paths(self):
        for chapter in CHAPTERS:
            with self.subTest(chapter=chapter["id"]):
                self.assertGreaterEqual(len(chapter["summary"]), 2)
                self.assertGreater(len(chapter["notes"]), 30)
                self.assertGreater(len((ASSETS / "chapters" / f'{chapter["id"]}.html').read_text()), 100)
                self.assertTrue((self.root / chapter["source"]).is_file())

    def test_existing_presentation_bookmarks_resolve(self):
        page = Document(self.outputs[PRESENTATION])
        for anchor in ("start", "aws-overview", "request-path", "network-zones", "environments",
                       "ownership", "hcl", "provider-state", "manual-inputs", "oidc", "images",
                       "secrets-db", "helm", "dns-check", "rollback", "diagram-tools", "references"):
            self.assertIn(anchor, page.ids)
        self.assertIn("data-aliases", self.outputs[PRESENTATION])

    def test_all_relative_links_and_fragments_resolve(self):
        validate_links(self.root, self.outputs)

    def test_missing_paths_and_fragments_are_rejected(self):
        for target in ("missing.html", "#missing", f"{PRESENTATION}#missing"):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "문서 링크"):
                validate_links(self.root, {COURSE: f'<a href="{target}">broken</a>'})

    def test_deterministic_check_is_read_only_and_detects_missing_or_stale_outputs(self):
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            destination = Path(directory)
            self.assertFalse(write_outputs(destination, self.outputs, check=True))
            self.assertEqual(list(destination.iterdir()), [])
            self.assertTrue(write_outputs(destination, self.outputs, check=False))
            self.assertTrue(write_outputs(destination, self.outputs, check=True))
            (destination / COURSE).write_text("stale")
            self.assertFalse(write_outputs(destination, self.outputs, check=True))
            self.assertEqual((destination / COURSE).read_text(), "stale")

    def test_cli_check_and_failure_status(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(["--root", str(self.root), "--check"]), 0)
            with patch("build_course.write_outputs", return_value=False):
                self.assertEqual(main(["--root", str(self.root), "--check"]), 1)


if __name__ == "__main__":
    unittest.main()
