"""coverage_gate 판정 검사 — `python3 -m unittest scripts/test_coverage_gate.py` (backend/ 에서).

하한 값은 상수에서 파생한다 — 래칫으로 하한을 올리는 PR 이 판정 로직과 무관하게 이 테스트를 깨지 않게.
"""

import os
import pathlib
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
import coverage_gate as gate  # noqa: E402

LINE_FLOOR = gate.TOTAL_FLOORS["LINE"]
BRANCH_FLOOR = gate.TOTAL_FLOORS["BRANCH"]


def counts(line_pct, branch_pct, total=1000):
    """비율 → (라인 덮음, 놓침, 분기 덮음, 놓침)."""
    line_c, branch_c = round(total * line_pct / 100), round(total * branch_pct / 100)
    return line_c, total - line_c, branch_c, total - branch_c


ABOVE = counts(min(LINE_FLOOR + 3, 100), min(BRANCH_FLOOR + 3, 100))


def report(packages):
    """packages: {이름: (라인 덮음, 라인 놓침, 분기 덮음, 분기 놓침)} → 합산 리포트 모양의 XML 루트."""
    root = ET.Element("report")
    totals = [0, 0, 0, 0]
    for name, (line_c, line_m, branch_c, branch_m) in packages.items():
        package = ET.SubElement(root, "package", name=name)
        ET.SubElement(package, "counter", type="LINE", covered=str(line_c), missed=str(line_m))
        if branch_c + branch_m:
            ET.SubElement(package, "counter", type="BRANCH", covered=str(branch_c), missed=str(branch_m))
        totals = [a + b for a, b in zip(totals, (line_c, line_m, branch_c, branch_m))]
    ET.SubElement(root, "counter", type="LINE", covered=str(totals[0]), missed=str(totals[1]))
    if totals[2] + totals[3]:
        ET.SubElement(root, "counter", type="BRANCH", covered=str(totals[2]), missed=str(totals[3]))
    return root


def by_segment(*names):
    """테스트용 소유 지도 — `com/trippilot/<x>/...` 를 모듈 `<x>` 가 갖는다."""
    return {n: {n.split("/")[2]} for n in names}


class CoverageGateTest(unittest.TestCase):
    def test_기준선_위면_통과(self):
        _, _, failures = gate.evaluate(report({"com/trippilot/trip": ABOVE}), by_segment("com/trippilot/trip"))
        self.assertEqual(failures, [])

    def test_전체_라인이_하한_아래면_실패(self):
        pkg = {"com/trippilot/trip": counts(LINE_FLOOR - 5, BRANCH_FLOOR + 3)}
        _, _, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertTrue(any(f.startswith("전체 LINE") for f in failures), failures)

    def test_전체_분기만_하한_아래여도_실패(self):
        pkg = {"com/trippilot/trip": counts(LINE_FLOOR + 3, BRANCH_FLOOR - 5)}
        _, _, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertTrue(any(f.startswith("전체 BRANCH") for f in failures), failures)

    def test_전체는_위인데_새_모듈_하나가_0퍼센트면_실패(self):
        pkg = {"com/trippilot/trip": (10000, 0, 10000, 0), "com/trippilot/newmod": (0, 30, 0, 30)}
        totals, _, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertGreater(totals["BRANCH"], BRANCH_FLOOR)
        self.assertTrue(any(f.startswith("newmod BRANCH 0.0%") for f in failures), failures)

    def test_새_모듈이_기존_모듈과_같은_패키지_아래여도_따로_센다(self):
        """이름(세 번째 세그먼트)으로 모듈을 정하면 newmod 가 trip 에 섞여 0% 가 가려진다."""
        pkg = {"com/trippilot/trip": (10000, 0, 10000, 0), "com/trippilot/trip/extra": (0, 30, 0, 30)}
        owners = {"com/trippilot/trip": {"modules/trip"}, "com/trippilot/trip/extra": {"modules/newmod"}}
        _, modules, failures = gate.evaluate(report(pkg), owners)
        self.assertEqual(modules["modules/newmod"]["BRANCH"], 0.0)
        self.assertTrue(any(f.startswith("modules/newmod BRANCH") for f in failures), failures)

    def test_하위_패키지는_소유_모듈로_합친다(self):
        pkg = {"com/trippilot/trip/domain": (10, 0, 10, 0), "com/trippilot/trip/adapter/in/web": (0, 10, 0, 10)}
        _, modules, _ = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertEqual(modules["trip"]["LINE"], 50.0)

    def test_분기가_없는_모듈은_n_a_이고_실패도_정렬_맨위도_아니다(self):
        pkg = {"com/trippilot/dto": (10, 0, 0, 0), "com/trippilot/trip": ABOVE}
        totals, modules, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertIsNone(modules["dto"]["BRANCH"])
        self.assertEqual(failures, [])
        rows = [r for r in gate.render(totals, modules, failures).splitlines() if r.startswith("| ") and "모듈" not in r]
        self.assertTrue(rows[0].startswith("| trip"), rows)
        self.assertIn("n/a", rows[-1])

    def test_전체에_분기가_하나도_없으면_하락이_아니라_측정_대상_없음으로_실패(self):
        pkg = {"com/trippilot/dto": (10, 0, 0, 0)}
        totals, modules, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        self.assertIsNone(totals["BRANCH"])
        self.assertIn("전체 BRANCH 측정 대상이 없다(합산 대상·계측 범위 설정을 본다)", failures)
        gate.render(totals, modules, failures)  # None 이어도 렌더링이 터지지 않는다

    def test_실패_사유가_요약에도_실린다(self):
        pkg = {"com/trippilot/trip": counts(LINE_FLOOR - 5, BRANCH_FLOOR + 3)}
        totals, modules, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        rendered = gate.render(totals, modules, failures)
        self.assertIn("**실패:**", rendered)
        self.assertIn(failures[0], rendered)

    def test_리포트_경로가_없으면_exit_2(self):
        self.assertEqual(gate.main([]), 2)

    def test_리포트_파일이_없으면_exit_2(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(gate.main([os.path.join(d, "none.xml")]), 2)

    def test_실제_소스_트리에서_모듈_소유를_찾는다(self):
        # 특정 패키지·모듈 이름을 박지 않는다 — 무관한 이름 변경 리팩터가 이 테스트를 깨면 안 된다.
        # 분할 패키지(한 패키지를 두 모듈이 가짐)도 금지하지 않는다 — 판정은 "a+b" 모듈로 합쳐 계속한다.
        owners = gate.package_owners()
        self.assertTrue(owners, "소스 트리에서 패키지를 하나도 못 찾았다")
        modules = {m for v in owners.values() for m in v}
        self.assertTrue(all((gate.BACKEND / m / "build.gradle.kts").exists() for m in modules), modules)

    def test_소유_모듈을_못_찾은_패키지는_조용히_흘리지_않고_실패한다(self):
        pkg = {"com/trippilot/trip": ABOVE, "com/trippilot/orphan": ABOVE}
        _, _, failures = gate.evaluate(report(pkg), {"com/trippilot/trip": {"modules/trip"}})
        self.assertIn("com/trippilot/orphan: 소유 모듈을 못 찾았다(소스 디렉터리와 package 선언이 어긋났나)", failures)

    def test_라인만_바닥을_어긴_모듈도_표_맨_위에_온다(self):
        pkg = {"com/trippilot/a": counts(100, 51), "com/trippilot/b": counts(gate.MODULE_FLOORS["LINE"] - 10, 100)}
        totals, modules, failures = gate.evaluate(report(pkg), by_segment(*pkg))
        rows = [r for r in gate.render(totals, modules, failures).splitlines() if r.startswith("| ") and "모듈" not in r]
        self.assertTrue(rows[0].startswith("| b"), rows)


if __name__ == "__main__":
    unittest.main()
