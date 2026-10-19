"""coverage_gate 판정 검사 — `python3 -m unittest scripts/test_coverage_gate.py` (backend/ 에서).

하한 값은 상수에서 파생한다 — 래칫으로 하한을 올리는 PR 이 판정 로직과 무관하게 이 테스트를 깨지 않게.
CI 환경 변수(GITHUB_STEP_SUMMARY·GITHUB_ACTIONS·COVERAGE_ADVISORY)는 떼어 놓는다 — 안 떼면 이 검사가
진짜 잡 요약에 가짜 표를 쓰고 커밋 체크에 가짜 주석을 남긴다(실측).
"""

import contextlib
import io
import os
import pathlib
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
UNOWNED = "의 소유 모듈을 하나로 정할 수 없다"


def counts(line_pct, branch_pct, total=1000):
    """비율 → (라인 덮음, 놓침, 분기 덮음, 놓침)."""
    line_c, branch_c = round(total * line_pct / 100), round(total * branch_pct / 100)
    return line_c, total - line_c, branch_c, total - branch_c


SAFE = counts(SAFE_LINE, SAFE_BRANCH)


def report(classes):
    """classes: {"com/trippilot/.../Class": (라인 덮음, 놓침, 분기 덮음, 놓침)} → 합산 리포트 모양의 XML 루트."""
    root = ET.Element("report")
    packages, totals = {}, [0, 0, 0, 0]
    for name, (line_c, line_m, branch_c, branch_m) in classes.items():
        package_name = name.rsplit("/", 1)[0]
        package = packages.get(package_name) or ET.SubElement(root, "package", name=package_name)
        packages[package_name] = package
        cls = ET.SubElement(package, "class", name=name)
        ET.SubElement(cls, "counter", type="LINE", covered=str(line_c), missed=str(line_m))
        if branch_c + branch_m:
            ET.SubElement(cls, "counter", type="BRANCH", covered=str(branch_c), missed=str(branch_m))
        totals = [a + b for a, b in zip(totals, (line_c, line_m, branch_c, branch_m))]
    ET.SubElement(root, "counter", type="LINE", covered=str(totals[0]), missed=str(totals[1]))
    if totals[2] + totals[3]:
        ET.SubElement(root, "counter", type="BRANCH", covered=str(totals[2]), missed=str(totals[3]))
    return root


def by_segment(*names):
    """테스트 픽스처일 뿐이다 — `com/trippilot/<x>/...` 클래스를 모듈 `<x>` 가 가진 것으로 손으로 지어 준다.
    실제 소유 판정(class_owners)은 아래 합성 트리 테스트가 따로 본다."""
    return {n: {n.split("/")[2]} for n in names}


def rows(totals, modules, failures):
    return [r for r in gate.render(totals, modules, failures).splitlines() if r.startswith("| ") and "모듈" not in r]


class CoverageGateTest(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        for key in ("GITHUB_STEP_SUMMARY", "GITHUB_ACTIONS", "COVERAGE_ADVISORY"):
            os.environ.pop(key, None)

    def run_main(self, argv, backend=None):
        """main() 은 settings·빌드 트리를 읽는다 — 실제 리포 대신 임시 트리를 보게 한다(실행 환경에 따라 달라지지 않게)."""
        if backend is None:
            backend = pathlib.Path(tempfile.mkdtemp())
            self.addCleanup(lambda: __import__("shutil").rmtree(backend, ignore_errors=True))
            (backend / "settings.gradle.kts").write_text("")
        patcher = mock.patch.object(gate, "BACKEND", backend)
        patcher.start()
        self.addCleanup(patcher.stop)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = gate.main(argv)
        return code, out.getvalue()

    # ── 하한 ─────────────────────────────────────────────────────────────

    def test_기준선_위면_통과(self):
        classes = {"com/trippilot/trip/A": SAFE}
        self.assertEqual(gate.evaluate(report(classes), by_segment(*classes))[2], [])

    def test_전체_라인이_하한_아래면_실패(self):
        classes = {"com/trippilot/trip/A": counts(TOTAL["LINE"] - 5, SAFE_BRANCH)}
        failures = gate.evaluate(report(classes), by_segment(*classes))[2]
        self.assertTrue(any(f.startswith("전체 LINE") for f in failures), failures)

    def test_전체_분기만_하한_아래여도_실패(self):
        classes = {"com/trippilot/trip/A": counts(SAFE_LINE, TOTAL["BRANCH"] - 5)}
        failures = gate.evaluate(report(classes), by_segment(*classes))[2]
        self.assertTrue(any(f.startswith("전체 BRANCH") for f in failures), failures)

    def test_전체에_분기가_하나도_없으면_하락이_아니라_측정_대상_없음으로_실패(self):
        classes = {"com/trippilot/dto/D": (10, 0, 0, 0)}
        totals, modules, failures = gate.evaluate(report(classes), by_segment(*classes))
        self.assertIsNone(totals["BRANCH"])
        self.assertIn("전체 BRANCH 측정 대상이 없다(합산 대상·계측 범위 설정을 본다)", failures)
        gate.render(totals, modules, failures)  # None 이어도 렌더링이 터지지 않는다

    # ── 모듈 소유 ──────────────────────────────────────────────────────────

    def test_전체는_위인데_새_모듈_하나가_0퍼센트면_실패(self):
        classes = {"com/trippilot/trip/A": (10000, 0, 10000, 0), "com/trippilot/newmod/B": (0, 30, 0, 30)}
        totals, _, failures = gate.evaluate(report(classes), by_segment(*classes))
        self.assertGreater(totals["BRANCH"], TOTAL["BRANCH"])
        self.assertTrue(any(f.startswith("newmod BRANCH 0.00%") for f in failures), failures)

    def test_새_모듈이_기존_모듈과_같은_패키지에_클래스를_둬도_따로_센다(self):
        """패키지로 소유를 정하면 newmod 의 0% 가 trip 수천 분기에 섞여 사라진다."""
        classes = {"com/trippilot/trip/A": (10000, 0, 10000, 0), "com/trippilot/trip/B": (0, 30, 0, 30)}
        owners = {"com/trippilot/trip/A": {"modules/trip"}, "com/trippilot/trip/B": {"modules/newmod"}}
        _, modules, failures = gate.evaluate(report(classes), owners)
        self.assertEqual(modules["modules/newmod"]["BRANCH"], 0.0)
        self.assertTrue(any(f.startswith("modules/newmod BRANCH") for f in failures), failures)

    def test_어느_모듈에도_없는_클래스는_조용히_흘리지_않고_실패하고_표에는_안_나온다(self):
        classes = {"com/trippilot/trip/A": SAFE, "com/trippilot/orphan/O": counts(10, 10)}
        totals, modules, failures = gate.evaluate(report(classes), by_segment("com/trippilot/trip/A"))
        self.assertTrue(any(UNOWNED in f and "com/trippilot/orphan/O" in f for f in failures), failures)
        self.assertFalse(any(r.startswith("| ?") for r in rows(totals, modules, failures)))

    def test_같은_클래스를_두_모듈이_가지면_합치지_않고_실패한다(self):
        classes = {"com/trippilot/trip/Mappers": SAFE}
        failures = gate.evaluate(report(classes), {"com/trippilot/trip/Mappers": {"modules/trip", "modules/newmod"}})[2]
        self.assertTrue(any(UNOWNED in f and "com/trippilot/trip/Mappers" in f for f in failures), failures)

    def test_소유_못_찾은_클래스가_많아도_사유는_한_줄로_묶는다(self):
        classes = {f"com/trippilot/orphan/C{i}": counts(10, 10) for i in range(40)}
        failures = gate.evaluate(report(classes), {})[2]
        unowned = [f for f in failures if UNOWNED in f]
        self.assertEqual(len(unowned), 1, failures)
        self.assertIn("클래스 40개", unowned[0])
        self.assertIn(f"외 {40 - gate.UNOWNED_SHOWN}개", unowned[0])

    def test_settings_에_있는데_합산_리포트에_없는_모듈은_실패한다(self):
        classes = {"com/trippilot/trip/A": SAFE}
        failures = gate.evaluate(report(classes), by_segment(*classes), expected={"trip", "newmod"})[2]
        self.assertTrue(any(f.startswith("newmod: 합산 리포트에 없다") for f in failures), failures)

    def test_표시는_버림이라_하한_바로_아래가_하한값으로_보이지_않는다(self):
        self.assertEqual(gate.fmt(93.96, 94.0), "93.9% ❌")
        self.assertEqual(gate.down(93.996, 2), "93.99")

    def test_settings_는_여러_인자_include_와_주석을_다룬다(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / "settings.gradle.kts").write_text('include(":app")   // 앱\ninclude( ":modules:a", ":modules:b" )\n// include(":modules:old")\n')
            self.assertEqual(gate.settings_modules(root), {"app", "modules/a", "modules/b"})

    def test_main_은_settings_모듈이_전부_합산되고_하한_위면_통과한다(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / "settings.gradle.kts").write_text('include(":modules:trip")\ninclude(":common:test-support")\n')
            f = root / "modules/trip/build/classes/kotlin/main/com/trippilot/trip/A.class"
            f.parent.mkdir(parents=True)
            f.write_bytes(b"")
            xml = root / "r.xml"
            ET.ElementTree(report({"com/trippilot/trip/A": SAFE})).write(xml)
            self.assertEqual(self.run_main([str(xml)], backend=root)[0], 0)   # test-support 는 합산 안 돼도 된다

    def test_class_owners_는_settings_모듈의_빌드_산출물로만_소유를_정한다(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / "settings.gradle.kts").write_text('include(":app")\ninclude(":modules:trip")   // 주석\n')

            def classfile(module, name):
                f = root / module / "build" / "classes" / "kotlin" / "main" / f"{name}.class"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b"")

            classfile("modules/trip", "com/trippilot/trip/Foo")
            classfile("modules/trip", "com/trippilot/trip/Foo$Inner")
            classfile("app", "com/trippilot/app/Main")
            classfile("modules/old-trip", "com/trippilot/trip/Foo")   # 옮긴 뒤 남은 옛 build 폴더
            owners = gate.class_owners(root)
            self.assertEqual(gate.settings_modules(root), {"app", "modules/trip"})
            self.assertEqual(owners["com/trippilot/trip/Foo"], {"modules/trip"})   # 옛 폴더를 세지 않는다
            self.assertEqual(owners["com/trippilot/trip/Foo$Inner"], {"modules/trip"})
            self.assertEqual(owners["com/trippilot/app/Main"], {"app"})

    def test_같은_모듈의_클래스는_합산한다(self):
        classes = {"com/trippilot/trip/domain/A": (10, 0, 10, 0), "com/trippilot/trip/adapter/in/web/B": (0, 10, 0, 10)}
        _, modules, _ = gate.evaluate(report(classes), by_segment(*classes))
        self.assertEqual(modules["trip"]["LINE"], 50.0)

    # ── 표 ────────────────────────────────────────────────────────────────

    def test_분기가_없는_모듈은_n_a_이고_실패도_정렬_맨위도_아니다(self):
        # 전체는 하한 위, trip 의 라인 여유(SAFE_LINE − 바닥)를 dto(100 − 바닥)보다 작게 둔다.
        classes = {"com/trippilot/dto/D": (10, 0, 0, 0), "com/trippilot/trip/A": counts(min(SAFE_LINE, 99), SAFE_BRANCH)}
        totals, modules, failures = gate.evaluate(report(classes), by_segment(*classes))
        self.assertIsNone(modules["dto"]["BRANCH"])
        self.assertEqual(failures, [])
        table = rows(totals, modules, failures)
        self.assertTrue(table[0].startswith("| trip"), table)
        self.assertIn("n/a", table[-1])

    def test_라인만_바닥을_어긴_모듈도_표_맨_위에_온다(self):
        classes = {"com/trippilot/a/A": counts(100, MODULE["BRANCH"] + 1), "com/trippilot/b/B": counts(MODULE["LINE"] - 10, 100)}
        totals, modules, failures = gate.evaluate(report(classes), by_segment(*classes))
        self.assertTrue(rows(totals, modules, failures)[0].startswith("| b"))

    def test_실패_사유가_요약에도_실린다(self):
        classes = {"com/trippilot/trip/A": counts(TOTAL["LINE"] - 5, SAFE_BRANCH)}
        totals, modules, failures = gate.evaluate(report(classes), by_segment(*classes))
        rendered = gate.render(totals, modules, failures)
        self.assertIn("**실패:**", rendered)
        self.assertIn(failures[0], rendered)

    # ── 판정 못 함·모드 ────────────────────────────────────────────────────

    def test_리포트_경로가_없으면_exit_2(self):
        self.assertEqual(self.run_main([])[0], 2)

    def test_리포트_파일이_없으면_exit_2_와_요약_advisory_면_0(self):
        with tempfile.TemporaryDirectory() as d:
            missing, summary = os.path.join(d, "none.xml"), os.path.join(d, "summary.md")
            os.environ["GITHUB_STEP_SUMMARY"] = summary
            self.assertEqual(self.run_main([missing])[0], 2)
            self.assertIn("리포트가 없다", open(summary, encoding="utf-8").read())
            os.environ["COVERAGE_ADVISORY"] = "1"
            self.assertEqual(self.run_main([missing])[0], 0)

    def test_깨진_리포트는_하한_아래와_구별되게_exit_2_와_요약_advisory_면_0(self):
        with tempfile.TemporaryDirectory() as d:
            broken, summary = os.path.join(d, "broken.xml"), os.path.join(d, "summary.md")
            open(broken, "w").close()
            os.environ["GITHUB_STEP_SUMMARY"] = summary
            self.assertEqual(self.run_main([broken])[0], 2)
            self.assertIn("리포트를 읽지 못했다", open(summary, encoding="utf-8").read())
            os.environ["COVERAGE_ADVISORY"] = "1"
            self.assertEqual(self.run_main([broken])[0], 0)

    def test_advisory_는_통과시키고_actions_안에서만_주석을_낸다(self):
        with tempfile.TemporaryDirectory() as d:
            xml = os.path.join(d, "r.xml")
            ET.ElementTree(report({"com/trippilot/orphan/O": counts(10, 10)})).write(xml)
            code, out = self.run_main([xml])
            self.assertEqual(code, 1)
            self.assertNotIn("::", out)  # 로컬(Actions 밖)에서는 주석을 내지 않는다
            os.environ["GITHUB_ACTIONS"] = "true"
            self.assertIn("::error title=커버리지 게이트::", self.run_main([xml])[1])
            os.environ["COVERAGE_ADVISORY"] = "1"
            code, out = self.run_main([xml])
            self.assertEqual(code, 0)
            self.assertIn("::warning title=커버리지 게이트(막지 않음)::", out)


if __name__ == "__main__":
    unittest.main()
