"""coverage_gate 판정 검사 — `python3 -m unittest scripts/test_coverage_gate.py` (backend/ 에서).

하한 값은 상수에서 파생한다 — 래칫으로 하한을 올리는 PR 이 판정 로직과 무관하게 이 테스트를 깨지 않게.
CI 환경 변수(GITHUB_STEP_SUMMARY·GITHUB_ACTIONS·COVERAGE_ADVISORY)는 떼어 놓는다 — 안 떼면 이 검사가
진짜 잡 요약에 가짜 표를 쓰고 커밋 체크에 가짜 주석을 남긴다(실측).
"""

import contextlib
import io
import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import coverage_gate as gate  # noqa: E402

TOTAL, MODULE = gate.TOTAL_FLOORS, gate.MODULE_FLOORS
SAFE_LINE = min(max(TOTAL["LINE"], MODULE["LINE"]) + 1, 100)       # 전체·모듈 하한 모두 위
SAFE_BRANCH = min(max(TOTAL["BRANCH"], MODULE["BRANCH"]) + 1, 100)


def counts(line_pct, branch_pct, total=1000):
    """비율 → (라인 덮음, 놓침, 분기 덮음, 놓침)."""
    line_c, branch_c = round(total * line_pct / 100), round(total * branch_pct / 100)
    return line_c, total - line_c, branch_c, total - branch_c


SAFE = counts(SAFE_LINE, SAFE_BRANCH)


def report(files):
    """files: {"패키지/파일.kt": (라인 덮음, 놓침, 분기 덮음, 놓침)} → 합산 리포트 모양의 XML 루트."""
    root = ET.Element("report")
    packages, totals = {}, [0, 0, 0, 0]
    for path, (line_c, line_m, branch_c, branch_m) in files.items():
        package_name, file_name = path.rsplit("/", 1)
        package = packages.get(package_name) or ET.SubElement(root, "package", name=package_name)
        packages[package_name] = package
        source = ET.SubElement(package, "sourcefile", name=file_name)
        ET.SubElement(source, "counter", type="LINE", covered=str(line_c), missed=str(line_m))
        if branch_c + branch_m:
            ET.SubElement(source, "counter", type="BRANCH", covered=str(branch_c), missed=str(branch_m))
        totals = [a + b for a, b in zip(totals, (line_c, line_m, branch_c, branch_m))]
    ET.SubElement(root, "counter", type="LINE", covered=str(totals[0]), missed=str(totals[1]))
    if totals[2] + totals[3]:
        ET.SubElement(root, "counter", type="BRANCH", covered=str(totals[2]), missed=str(totals[3]))
    return root


def by_segment(*paths):
    """테스트용 소유 지도 — `com/trippilot/<x>/.../F.kt` 를 모듈 `<x>` 가 갖는다."""
    return {p: {p.split("/")[2]} for p in paths}


UNOWNED = "소유 모듈을 하나로 정할 수 없다(소스 폴더에 그 경로가 없거나 두 모듈에 있다 — package 선언·파일 위치를 본다)"


def rows(totals, modules, failures):
    return [r for r in gate.render(totals, modules, failures).splitlines() if r.startswith("| ") and "모듈" not in r]


class CoverageGateTest(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for key in ("GITHUB_STEP_SUMMARY", "GITHUB_ACTIONS", "COVERAGE_ADVISORY"):
            os.environ.pop(key, None)

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = gate.main(argv)
        return code, out.getvalue()

    def test_기준선_위면_통과(self):
        files = {"com/trippilot/trip/A.kt": SAFE}
        self.assertEqual(gate.evaluate(report(files), by_segment(*files))[2], [])

    def test_전체_라인이_하한_아래면_실패(self):
        files = {"com/trippilot/trip/A.kt": counts(TOTAL["LINE"] - 5, SAFE_BRANCH)}
        failures = gate.evaluate(report(files), by_segment(*files))[2]
        self.assertTrue(any(f.startswith("전체 LINE") for f in failures), failures)

    def test_전체_분기만_하한_아래여도_실패(self):
        files = {"com/trippilot/trip/A.kt": counts(SAFE_LINE, TOTAL["BRANCH"] - 5)}
        failures = gate.evaluate(report(files), by_segment(*files))[2]
        self.assertTrue(any(f.startswith("전체 BRANCH") for f in failures), failures)

    def test_전체는_위인데_새_모듈_하나가_0퍼센트면_실패(self):
        files = {"com/trippilot/trip/A.kt": (10000, 0, 10000, 0), "com/trippilot/newmod/B.kt": (0, 30, 0, 30)}
        totals, _, failures = gate.evaluate(report(files), by_segment(*files))
        self.assertGreater(totals["BRANCH"], TOTAL["BRANCH"])
        self.assertTrue(any(f.startswith("newmod BRANCH 0.0%") for f in failures), failures)

    def test_새_모듈이_기존_모듈과_같은_패키지에_파일을_둬도_따로_센다(self):
        """패키지로 소유를 정하면 newmod 의 0% 가 trip 수천 분기에 섞여 사라진다."""
        files = {"com/trippilot/trip/A.kt": (10000, 0, 10000, 0), "com/trippilot/trip/B.kt": (0, 30, 0, 30)}
        owners = {"com/trippilot/trip/A.kt": {"modules/trip"}, "com/trippilot/trip/B.kt": {"modules/newmod"}}
        _, modules, failures = gate.evaluate(report(files), owners)
        self.assertEqual(modules["modules/newmod"]["BRANCH"], 0.0)
        self.assertTrue(any(f.startswith("modules/newmod BRANCH") for f in failures), failures)

    def test_측정_대상이_0인_파일은_건너뛴다_인라인으로_생긴_남의_파일_이름(self):
        # compareBy 같은 인라인 함수가 만든 클래스는 표준 라이브러리 파일 이름(Comparisons.kt)을 달고 0/0 으로 나온다.
        files = {"com/trippilot/trip/A.kt": SAFE, "com/trippilot/trip/Comparisons.kt": (0, 0, 0, 0)}
        _, modules, failures = gate.evaluate(report(files), by_segment("com/trippilot/trip/A.kt"))
        self.assertEqual(failures, [])
        self.assertEqual(set(modules), {"trip"})

    def test_package_선언이_폴더와_다른_파일은_다른_모듈에_붙지_않고_실패한다(self):
        # 리포트는 선언 패키지(trip/application)로 묶지만 파일은 foo 모듈의 다른 폴더에 있다.
        files = {"com/trippilot/trip/application/A.kt": SAFE, "com/trippilot/trip/application/X.kt": SAFE}
        owners = {"com/trippilot/trip/application/A.kt": {"modules/trip"}, "com/trippilot/foo/X.kt": {"modules/foo"}}
        failures = gate.evaluate(report(files), owners)[2]
        self.assertIn(f"com/trippilot/trip/application/X.kt: {UNOWNED}", failures)

    def test_같은_경로를_두_모듈이_가지면_합치지_않고_실패한다(self):
        files = {"com/trippilot/trip/Mappers.kt": SAFE}
        failures = gate.evaluate(report(files), {"com/trippilot/trip/Mappers.kt": {"modules/trip", "modules/newmod"}})[2]
        self.assertIn(f"com/trippilot/trip/Mappers.kt: {UNOWNED}", failures)

    def test_하위_패키지는_소유_모듈로_합친다(self):
        files = {"com/trippilot/trip/domain/A.kt": (10, 0, 10, 0), "com/trippilot/trip/adapter/in/web/B.kt": (0, 10, 0, 10)}
        _, modules, _ = gate.evaluate(report(files), by_segment(*files))
        self.assertEqual(modules["trip"]["LINE"], 50.0)

    def test_분기가_없는_모듈은_n_a_이고_실패도_정렬_맨위도_아니다(self):
        # 전체는 하한 위, trip 의 라인 여유(SAFE_LINE − 바닥)를 dto(100 − 바닥)보다 작게 둔다.
        files = {"com/trippilot/dto/D.kt": (10, 0, 0, 0), "com/trippilot/trip/A.kt": counts(min(SAFE_LINE, 99), SAFE_BRANCH)}
        totals, modules, failures = gate.evaluate(report(files), by_segment(*files))
        self.assertIsNone(modules["dto"]["BRANCH"])
        self.assertEqual(failures, [])
        table = rows(totals, modules, failures)
        self.assertTrue(table[0].startswith("| trip"), table)
        self.assertIn("n/a", table[-1])

    def test_라인만_바닥을_어긴_모듈도_표_맨_위에_온다(self):
        files = {"com/trippilot/a/A.kt": counts(100, MODULE["BRANCH"] + 1), "com/trippilot/b/B.kt": counts(MODULE["LINE"] - 10, 100)}
        totals, modules, failures = gate.evaluate(report(files), by_segment(*files))
        self.assertTrue(rows(totals, modules, failures)[0].startswith("| b"))

    def test_전체에_분기가_하나도_없으면_하락이_아니라_측정_대상_없음으로_실패(self):
        files = {"com/trippilot/dto/D.kt": (10, 0, 0, 0)}
        totals, modules, failures = gate.evaluate(report(files), by_segment(*files))
        self.assertIsNone(totals["BRANCH"])
        self.assertIn("전체 BRANCH 측정 대상이 없다(합산 대상·계측 범위 설정을 본다)", failures)
        gate.render(totals, modules, failures)  # None 이어도 렌더링이 터지지 않는다

    def test_실패_사유가_요약에도_실린다(self):
        files = {"com/trippilot/trip/A.kt": counts(TOTAL["LINE"] - 5, SAFE_BRANCH)}
        totals, modules, failures = gate.evaluate(report(files), by_segment(*files))
        rendered = gate.render(totals, modules, failures)
        self.assertIn("**실패:**", rendered)
        self.assertIn(failures[0], rendered)

    def test_깨진_리포트는_막는_모드에선_예외_advisory_에선_경고와_0(self):
        with tempfile.TemporaryDirectory() as d:
            broken = os.path.join(d, "broken.xml")
            open(broken, "w").close()
            with self.assertRaises(ET.ParseError):
                self.run_main([broken])
            os.environ["COVERAGE_ADVISORY"] = "1"
            self.assertEqual(self.run_main([broken])[0], 0)

    def test_리포트가_없으면_요약에도_사유를_쓴다(self):
        with tempfile.TemporaryDirectory() as d:
            summary = os.path.join(d, "summary.md")
            os.environ["GITHUB_STEP_SUMMARY"] = summary
            self.run_main([os.path.join(d, "none.xml")])
            self.assertIn("리포트가 없다", open(summary, encoding="utf-8").read())

    def test_리포트_경로가_없으면_exit_2(self):
        self.assertEqual(self.run_main([])[0], 2)

    def test_리포트_파일이_없으면_exit_2_advisory_면_0(self):
        with tempfile.TemporaryDirectory() as d:
            missing = os.path.join(d, "none.xml")
            self.assertEqual(self.run_main([missing])[0], 2)
            os.environ["COVERAGE_ADVISORY"] = "1"
            self.assertEqual(self.run_main([missing])[0], 0)

    def test_advisory_는_통과시키고_actions_안에서만_주석을_낸다(self):
        with tempfile.TemporaryDirectory() as d:
            xml = os.path.join(d, "r.xml")
            ET.ElementTree(report({"com/trippilot/orphan/O.kt": counts(10, 10)})).write(xml)
            code, out = self.run_main([xml])
            self.assertEqual(code, 1)
            self.assertNotIn("::", out)  # 로컬(Actions 밖)에서는 주석을 내지 않는다
            os.environ["GITHUB_ACTIONS"] = "true"
            self.assertIn("::error title=커버리지 게이트::", self.run_main([xml])[1])
            os.environ["COVERAGE_ADVISORY"] = "1"
            code, out = self.run_main([xml])
            self.assertEqual(code, 0)
            self.assertIn("::warning title=커버리지 게이트(막지 않음)::", out)

    def test_실제_소스_트리에서_모듈_소유를_찾는다(self):
        # 특정 파일·모듈 이름을 박지 않는다 — 무관한 이름 변경 리팩터가 이 테스트를 깨면 안 된다.
        owners = gate.source_owners()
        self.assertTrue(owners, "소스 트리에서 파일을 하나도 못 찾았다")
        modules = {m for v in owners.values() for m in v}
        self.assertTrue(all((gate.BACKEND / m / "build.gradle.kts").exists() for m in modules), modules)


if __name__ == "__main__":
    unittest.main()
