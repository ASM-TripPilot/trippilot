"""수집 산출물 검증·게시 — Airflow 없이 돈다. `python3 -m unittest discover -s batch/tests` (리포 루트에서)."""

import shutil
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402
import pipeline  # noqa: E402

SIDOS = checks.sido_names()   # 실제 백엔드 시드에서 — 목록을 여기 따로 적지 않는다


def proposal(name, address):
    return {"poi": {"name": name}, "provenance": {"address": address}}


def pois(*addresses, extra=0):
    items = [proposal(f"p{i}", a) for i, a in enumerate(addresses)]
    items += [proposal(f"x{i}", "서울특별시 양천구 신정동 1") for i in range(extra)]
    return {"proposals": items}


class BackendReadsTest(unittest.TestCase):
    """백엔드 RegionResolver 와 같은 판정 — 첫 낱말이 시도 정식 이름과 정확히 같아야 한다(약칭은 수집 병합이 편다)."""

    def test_시드에서_시도_16곳을_읽는다(self):
        self.assertEqual(len(SIDOS), 16)
        self.assertIn("제주특별자치도", SIDOS)

    def test_정식_이름만_읽는다(self):
        self.assertTrue(checks.backend_reads("서울특별시 양천구 신정동 1", SIDOS))
        self.assertFalse(checks.backend_reads("부산광역 사하구 하단동 1195", SIDOS))   # #1427 의 잘린 이름 — 병합이 펴야 한다
        self.assertFalse(checks.backend_reads("강원도 춘천시", SIDOS))
        self.assertFalse(checks.backend_reads("", SIDOS))
        self.assertFalse(checks.backend_reads(None, SIDOS))

    def test_공백은_백엔드처럼_ASCII_공백으로만_자른다(self):
        # 백엔드 Regex("\\s+") 는 NBSP·전각 공백으로 자르지 않아 첫 토큰이 통째가 된다 — 게이트도 같은 판정이어야 한다.
        self.assertFalse(checks.backend_reads("서울특별시\u00a0양천구", SIDOS))
        self.assertFalse(checks.backend_reads("서울특별시\u3000양천구", SIDOS))
        self.assertTrue(checks.backend_reads("  서울특별시\t양천구", SIDOS))

    def test_양끝은_Kotlin_trim_과_같은_문자만_자른다(self):
        # Python strip() 은 U+0085(NEL)도 자르지만 Kotlin trim() 은 남긴다 → 백엔드는 첫 토큰이 "\x85서울특별시" 라 못 읽는다.
        self.assertFalse(checks.backend_reads("\u0085서울특별시 양천구", SIDOS))
        self.assertTrue(checks.backend_reads("\u00a0\u3000서울특별시 양천구", SIDOS))   # NBSP·전각 공백은 Kotlin 도 자른다
        # JDK 25 Character.isWhitespace||isSpaceChar 를 BMP 전수로 뽑은 목록 — 집합이 바뀌면 백엔드와 다시 대조한다.
        java = "0009,000a,000b,000c,000d,001c,001d,001e,001f,0020,00a0,1680,2000,2001,2002,2003,2004,2005,2006,2007," \
               "2008,2009,200a,2028,2029,202f,205f,3000"
        self.assertEqual(",".join(f"{ord(c):04x}" for c in checks.KOTLIN_TRIM), java)


class CheckPoisTest(unittest.TestCase):
    def test_읽을_수_있는_문서는_통과(self):
        self.assertEqual(checks.check_pois(pois(extra=10), SIDOS, 10), [])

    def test_시도를_못_정하는_주소가_섞이면_게시를_막는다(self):
        failures = checks.check_pois(pois("부산광역 사하구 하단동 1195", "Tokyo, Japan", extra=10), SIDOS, 10)
        self.assertEqual(len(failures), 1)
        self.assertIn("시도를 정할 수 없는 주소 2건", failures[0])

    def test_건수가_하한_아래면_막는다(self):
        self.assertTrue(any("하한" in f and "비었다" in f for f in checks.check_pois(pois(extra=3), SIDOS, 10)))

    def test_문서_모양이_바뀌면_막는다(self):
        self.assertEqual(checks.check_pois({"items": []}, SIDOS, 0), ["proposals 목록이 없다 — 문서 모양이 바뀌었다"])

    def test_이름_없는_제안을_막는다(self):
        doc = pois(extra=10)
        doc["proposals"].append({"poi": {}, "provenance": {"address": "서울특별시 양천구 1"}})
        self.assertTrue(any("이름 없는 제안 1건" in f for f in checks.check_pois(doc, SIDOS, 10)))


class CheckEventsTest(unittest.TestCase):
    DAY = date(2026, 10, 10)
    FRESH = {"서울": "2026-10-09T06:46:38+09:00", "부산": "2026-09-01T06:46:38+09:00"}   # 가장 늦은 것 = 10-09

    def events(self, *spans, coverage=FRESH):
        return {"events": [{"start": s, "end": e} for s, e in spans], "coverage": coverage}

    def check(self, doc, min_valid=1, max_age=7):
        return checks.check_events(doc, self.DAY, min_valid, max_age)

    def test_그날_유효한_행사가_하한_이상이면_통과(self):
        self.assertEqual(self.check(self.events(("2026-10-01", "2026-10-31"))), [])

    def test_전체_건수가_많아도_그날_유효한_것이_적으면_막는다_낡은_사본(self):
        stale = self.events(*[("2026-08-01", "2026-08-31")] * 400, ("2026-10-01", "2026-10-31"))
        failures = self.check(stale, min_valid=30)
        self.assertEqual(len(failures), 1)
        self.assertIn("유효한 행사 1건 < 하한 30건 (전체 401건)", failures[0])

    def test_날짜가_깨진_행사는_유효로_세지_않는다(self):
        broken = {"events": [{"start": "2026-10-01"}, {"start": "어제", "end": "내일"}], "coverage": self.FRESH}
        self.assertTrue(self.check(broken))

    def test_문서_모양이_바뀌면_막는다(self):
        self.assertEqual(checks.check_events({}, self.DAY, 0, 7), ["events 목록이 없다 — 문서 모양이 바뀌었다"])

    def test_유효_건수가_넉넉해도_수집이_멈췄으면_막는다(self):
        # 미래 행사가 남아 유효 건수는 멀쩡하다 — 수집 시각만이 멈춘 것을 안다.
        old = self.events(("2026-10-01", "2026-12-31"), coverage={"서울": "2026-10-02T23:59:00+09:00"})
        failures = self.check(old)
        self.assertEqual(len(failures), 1)
        self.assertIn("마지막 수집 2026-10-02 — 2026-10-10 기준 8일 전 > 허용 7일", failures[0])

    def test_허용_날수_경계(self):
        exactly = self.events(("2026-10-01", "2026-12-31"), coverage={"서울": "2026-10-03T00:00:00+09:00"})
        self.assertEqual(self.check(exactly), [])   # 7일 전은 통과, 8일 전부터 막는다

    def test_수집_시각이_없거나_깨졌으면_막는다(self):
        for coverage in ({}, None, {"서울": "어제"}, ["2026-10-09"]):
            failures = self.check(self.events(("2026-10-01", "2026-10-31"), coverage=coverage))
            self.assertTrue(any("마지막 수집 시각이 없다" in f for f in failures), coverage)


class PipelineTest(unittest.TestCase):
    SEOUL = ZoneInfo("Asia/Seoul")

    def test_run_day_는_logical_date_가_없으면_run_after_를_KST_로(self):
        # 날짜 없이 수동 트리거하면 logical_date 가 없다 — UTC 19:00 은 KST 다음 날 04:00 이다.
        context = {"dag_run": SimpleNamespace(run_after=datetime(2026, 10, 20, 19, 0, tzinfo=timezone.utc))}
        self.assertEqual(pipeline.run_day(context, self.SEOUL).date(), date(2026, 10, 21))

    def test_run_day_는_logical_date_가_있으면_그것을(self):
        context = {"logical_date": datetime(2026, 10, 5, 19, 40, tzinfo=timezone.utc),
                   "dag_run": SimpleNamespace(run_after=datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc))}
        self.assertEqual(pipeline.run_day(context, self.SEOUL).date(), date(2026, 10, 6))

    def setUp(self):
        self.out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)
        patcher = mock.patch.object(pipeline, "OUT", self.out)
        patcher.start()
        self.addCleanup(patcher.stop)

    def candidate(self, run_id="manual__1"):
        path = pipeline.run_dir("poi_collect", run_id) / "c.json"
        path.write_text('{"ok": 1}', encoding="utf-8")
        return path

    def test_게시가_끝나면_그_실행의_후보_폴더를_지운다(self):
        candidate = self.candidate()
        target = pipeline.publish(candidate, self.out / "published/c.json")
        self.assertEqual(target.read_text(encoding="utf-8"), '{"ok": 1}')
        self.assertFalse(candidate.parent.exists())
        self.assertEqual(list(target.parent.iterdir()), [target])   # 임시 파일도 남지 않는다

    def test_run_dir_밖의_후보는_지우지_않는다(self):
        outside = self.out / "elsewhere/c.json"
        outside.parent.mkdir(parents=True)
        outside.write_text("{}", encoding="utf-8")
        pipeline.publish(outside, self.out / "published/c.json")
        self.assertTrue(outside.exists())

    def test_임시_파일은_실행마다_고유하고_실패하면_치운다(self):
        target = self.out / "published/c.json"
        seen = []
        real_copy = pipeline.shutil.copyfile

        def copy_then_fail(src, dst):
            seen.append(Path(dst))
            real_copy(src, dst)
            raise OSError("디스크 가득")

        with mock.patch.object(pipeline.shutil, "copyfile", copy_then_fail):
            for run_id in ("a", "b"):
                with self.assertRaises(OSError):
                    pipeline.publish(self.candidate(run_id), target)
        self.assertEqual(len(set(seen)), 2)                       # 고정 이름이면 두 게시가 같은 임시 파일을 쓴다
        self.assertTrue(all(p.parent == target.parent for p in seen))   # 같은 폴더 — replace 가 원자적이다
        self.assertEqual(list(target.parent.iterdir()), [])        # 실패한 임시 파일은 치웠다
        self.assertTrue((self.out / "runs/poi_collect/a").exists())   # 게시가 실패하면 후보는 남는다


if __name__ == "__main__":
    unittest.main()
