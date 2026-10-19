"""coverage_gate 판정 검사 — `python3 -m unittest scripts/test_coverage_gate.py` (backend/ 에서)."""

import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
import coverage_gate as gate  # noqa: E402


def report(packages):
    """packages: {이름: (라인 덮음, 라인 놓침, 분기 덮음, 분기 놓침)} → 합산 리포트 모양의 XML 루트."""
    root = ET.Element("report")
    totals = [0, 0, 0, 0]
    for name, counts in packages.items():
        package = ET.SubElement(root, "package", name=name)
        line_c, line_m, branch_c, branch_m = counts
        ET.SubElement(package, "counter", type="LINE", covered=str(line_c), missed=str(line_m))
        if branch_c + branch_m:
            ET.SubElement(package, "counter", type="BRANCH", covered=str(branch_c), missed=str(branch_m))
        totals = [a + b for a, b in zip(totals, counts)]
    ET.SubElement(root, "counter", type="LINE", covered=str(totals[0]), missed=str(totals[1]))
    ET.SubElement(root, "counter", type="BRANCH", covered=str(totals[2]), missed=str(totals[3]))
    return root


class CoverageGateTest(unittest.TestCase):
    def test_기준선_위면_통과(self):
        _, _, failures = gate.evaluate(report({"com/trippilot/trip": (990, 10, 990, 10)}))
        self.assertEqual(failures, [])

    def test_전체_라인이_하한_아래면_실패(self):
        _, _, failures = gate.evaluate(report({"com/trippilot/trip": (900, 100, 990, 10)}))
        self.assertTrue(any(f.startswith("전체 LINE") for f in failures), failures)

    def test_전체_분기만_하한_아래여도_실패(self):
        _, _, failures = gate.evaluate(report({"com/trippilot/trip": (990, 10, 800, 200)}))
        self.assertTrue(any(f.startswith("전체 BRANCH") for f in failures), failures)

    def test_전체는_위인데_새_모듈_하나가_0퍼센트면_실패(self):
        root = report({"com/trippilot/trip": (10000, 0, 10000, 0), "com/trippilot/newmod": (0, 30, 0, 30)})
        totals, _, failures = gate.evaluate(root)
        self.assertGreater(totals["BRANCH"], gate.TOTAL_FLOORS["BRANCH"])
        self.assertIn("newmod BRANCH 0.0% < 모듈 바닥 40%", failures)

    def test_하위_패키지는_모듈로_합친다(self):
        _, modules, _ = gate.evaluate(report({
            "com/trippilot/trip/domain": (10, 0, 10, 0),
            "com/trippilot/trip/adapter/in/web": (0, 10, 0, 10),
        }))
        self.assertEqual(modules["trip"]["LINE"], 50.0)

    def test_분기가_없는_모듈은_n_a_이고_실패도_정렬_맨위도_아니다(self):
        totals, modules, failures = gate.evaluate(report({
            "com/trippilot/dto": (10, 0, 0, 0),
            "com/trippilot/trip": (1000, 0, 900, 100),
        }))
        self.assertIsNone(modules["dto"]["BRANCH"])
        self.assertEqual(failures, [])
        table = gate.render(totals, modules, failures).splitlines()
        rows = [r for r in table if r.startswith("| ") and not r.startswith("| 모듈")]
        self.assertTrue(rows[0].startswith("| trip"), rows)
        self.assertIn("n/a", rows[-1])

    def test_실패_사유가_요약에도_실린다(self):
        totals, modules, failures = gate.evaluate(report({"com/trippilot/trip": (900, 100, 990, 10)}))
        rendered = gate.render(totals, modules, failures)
        self.assertIn("**실패:**", rendered)
        self.assertIn(failures[0], rendered)

    def test_리포트가_없으면_exit_2(self):
        missing = os.path.join(tempfile.mkdtemp(), "none.xml")
        sys.argv = ["coverage_gate.py", missing]
        self.assertEqual(gate.main(), 2)


if __name__ == "__main__":
    unittest.main()
