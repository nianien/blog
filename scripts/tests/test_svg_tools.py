"""Regression checks for SVG scope, validation and non-destructive fixes"""
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / ".agents/skills/svg-check"
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" font-family="sans-serif"><text x="20" y="40">Example</text></svg>'


class SvgToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_tool(self, name, *args, claude=False):
        base = ROOT / ".claude/skills/svg-check" if claude else TOOLS
        return subprocess.run([sys.executable, "-B", str(base / name), *map(str, args)], capture_output=True, text=True)

    def fixture(self, text=SVG, name="example.svg"):
        p = self.folder / name
        p.write_text(text)
        return p

    def test_single_file_and_compatibility_entry(self):
        p = self.fixture()
        for claude in (False, True):
            result = self.run_tool("svg-audit.py", p, claude=claude)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Scanned 1 SVG", result.stdout)

    def test_empty_missing_and_unscoped_targets_fail(self):
        for args in [(self.folder,), (self.folder / "missing",), ()]:
            self.assertNotEqual(self.run_tool("svg-audit.py", *args).returncode, 0)

    def test_nested_directory_is_included(self):
        nested = self.folder / "nested"
        nested.mkdir()
        (nested / "nested.svg").write_text(SVG)
        result = self.run_tool("svg-audit.py", self.folder)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Scanned 1 SVG", result.stdout)

    def test_malformed_xml_and_viewbox_fail(self):
        for text in ["<svg>", SVG.replace("0 0 200 100", "0 0 NaN 100"), SVG.replace("0 0 200 100", "0 0 0 100")]:
            result = self.run_tool("svg-audit.py", self.fixture(text))
            self.assertNotEqual(result.returncode, 0)

    def test_viewbox_syntax_variants_keep_geometry_checks(self):
        for attribute in ["viewBox='0 0 200 100'", 'viewBox="0,0,200,100"', 'viewBox="0, 0 200, 100"']:
            original = SVG.replace('viewBox="0 0 200 100"', attribute).replace(
                "</svg>", '<rect x="180" y="60" width="80" height="30"/></svg>')
            with self.subTest(attribute=attribute):
                p = self.fixture(original)
                result = self.run_tool("svg-audit.py", p, "--geometry-only")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("[G:RECT_OVERFLOW_RIGHT]", result.stdout)
                self.assertNotIn("NO_VIEWBOX", result.stdout)
                self.assertNotIn("MANUAL", result.stdout)
                self.assertEqual(p.read_text(), original)

    def test_modes_are_mutually_exclusive(self):
        self.assertNotEqual(self.run_tool("svg-audit.py", self.fixture(), "--geometry-only", "--convention-only").returncode, 0)

    def test_markers_and_css_refused_without_modification(self):
        marker = '<defs><marker id="a"><path fill="red"/></marker></defs><g transform="translate(20 20)"><path d="M 10 10 H 50" marker-end="url(#a)"/></g>'
        style = '<style>text {fill: red}</style>'
        for body in [marker, style]:
            original = SVG.replace("</svg>", body + "</svg>")
            p = self.fixture(original)
            result = self.run_tool("svg-fix.py", p)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(p.read_text(), original)

    def test_dry_run_then_safe_fix_then_idempotence(self):
        original = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="20" y="40" stroke-width="2">Example</text></svg>'
        p = self.fixture(original)
        result = self.run_tool("svg-fix.py", p, "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(p.read_text(), original)
        self.assertEqual(self.run_tool("svg-fix.py", p).returncode, 0)
        root = ET.parse(p).getroot()
        self.assertEqual(root.get("viewBox"), "0 0 200 100")
        self.assertIsNotNone(root.get("font-family"))
        self.assertEqual(list(root)[0].get("stroke-width"), "2")
        fixed = p.read_bytes()
        self.assertEqual(self.run_tool("svg-fix.py", p, claude=True).returncode, 0)
        self.assertEqual(p.read_bytes(), fixed)
        self.assertEqual(self.run_tool("svg-audit.py", p).returncode, 0)

    def test_required_validation_cannot_be_skipped(self):
        invalid = [
            SVG.replace(' viewBox="0 0 200 100"', ""),
            SVG.replace("0 0 200 100", "0 0 NaN 100"),
            SVG.replace("<svg ", "<g ").replace("</svg>", "</g>"),
        ]
        for content in invalid:
            for mode in [(), ("--geometry-only",), ("--convention-only",)]:
                with self.subTest(content=content, mode=mode):
                    result = self.run_tool("svg-audit.py", self.fixture(content), *mode)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("ERROR", result.stdout)

    def test_style_warnings_do_not_fail_or_modify(self):
        original = SVG.replace(' font-family="sans-serif"', "").replace(
            "</svg>", '<style>text {fill: red}</style><defs><marker id="arrow"/></defs>'
            '<line x1="20" y1="60" x2="80" y2="60" stroke-width="2" marker-end="url(#arrow)"/></svg>')
        p = self.fixture(original)
        result = self.run_tool("svg-audit.py", p)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for code in ["NO_FONT_FAMILY", "HAS_STYLE", "HAS_MARKER", "STROKE_WIDTH", "MARKER_REF"]:
            self.assertIn("[C:" + code + "]", result.stdout)
        self.assertIn("WARN", result.stdout)
        self.assertEqual(p.read_text(), original)
        geometry = self.run_tool("svg-audit.py", p, "--geometry-only")
        self.assertEqual(geometry.returncode, 0)
        self.assertNotIn("[C:", geometry.stdout)

    def test_geometry_suspicions_are_warnings(self):
        original = SVG.replace("</svg>", '<rect x="180" y="60" width="80" height="30"/></svg>')
        p = self.fixture(original)
        result = self.run_tool("svg-audit.py", p, "--geometry-only")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("WARN", result.stdout)
        self.assertIn("[G:RECT_OVERFLOW_RIGHT]", result.stdout)
        self.assertEqual(p.read_text(), original)

    def test_geometry_uses_exact_attribute_names(self):
        cases = [
            ('<rect rx="8" ry="8" data-x="300" data-y="300" width="200" height="100"/>', False),
            ('<rect rx="8" ry="8" x="180" y="60" width="80" height="30"/>', True),
        ]
        for rect, overflow in cases:
            with self.subTest(rect=rect):
                original = SVG.replace("</svg>", rect + "</svg>")
                p = self.fixture(original)
                result = self.run_tool("svg-audit.py", p, "--geometry-only")
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual("[G:RECT_OVERFLOW_RIGHT]" in result.stdout, overflow)
                self.assertNotIn("[G:RECT_OVERFLOW_BOTTOM]", result.stdout)
                self.assertEqual(p.read_text(), original)

    def test_transforms_are_reported_as_manual(self):
        p = self.fixture(SVG.replace('<text', '<text transform="translate(20 0)"'))
        result = self.run_tool("svg-audit.py", p)
        self.assertEqual(result.returncode, 0)
        self.assertIn("MANUAL", result.stdout)


if __name__ == "__main__":
    unittest.main()
