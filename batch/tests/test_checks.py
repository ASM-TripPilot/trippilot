"""수집 산출물 검증 — Airflow 없이 돈다. `python3 -m unittest discover -s batch/tests` (리포 루트에서)."""

import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402

SIDOS = checks.Sidos.load()   # 실제 백엔드 시드에서 — 목록을 여기 따로 적지 않는다


def proposal(name, address):
    return {"poi": {"name": name}, "provenance": {"address": address}}


def pois(*addresses, extra=0):
    items = [proposal(f"p{i}", a) for i, a in enumerate(addresses)]
    items += [proposal(f"x{i}", "서울특별시 양천구 신정동 1") for i in range(extra)]
    return {"proposals": items}


class SidoRuleTest(unittest.TestCase):
    """백엔드 RegionResolver.sidoOf 와 같은 규칙 — 정식 이름 → 별칭 → 유일 접두."""

    def test_시드에서_시도와_별칭을_읽는다(self):
        self.assertEqual(len(SIDOS.names), 16)
        self.assertEqual(SIDOS.names["서울특별시"], "11")
        self.assertEqual(SIDOS.aliases["강원도"], "51")

    def test_정식_이름_별칭_잘린_이름을_읽는다(self):
        self.assertEqual(SIDOS.code_of("서울특별시 양천구"), "11")
        self.assertEqual(SIDOS.code_of("강원도 춘천시"), "51")                 # 옛 이름(별칭)
        self.assertEqual(SIDOS.code_of("부산광역 사하구 하단동 1195"), "26")   # 잘린 이름(#1427 실측)
        self.assertEqual(SIDOS.code_of("제주특별자치 서귀포시 색달동 3039-41"), "50")

    def test_모호하거나_한_글자거나_모르는_이름은_정하지_않는다(self):
        self.assertIsNone(SIDOS.code_of("경상 어딘가"))   # 경상북도·경상남도
        self.assertIsNone(SIDOS.code_of("부 사하구"))
        self.assertIsNone(SIDOS.code_of("Tokyo, Japan"))
        self.assertIsNone(SIDOS.code_of(""))
        self.assertIsNone(SIDOS.code_of(None))


class CheckPoisTest(unittest.TestCase):
    def test_읽을_수_있는_문서는_통과(self):
        self.assertEqual(checks.check_pois(pois(extra=10), SIDOS, 10), [])

    def test_시도를_못_정하는_주소가_섞이면_게시를_막는다(self):
        failures = checks.check_pois(pois("Tokyo, Japan", "경상 어딘가", extra=10), SIDOS, 10)
        self.assertEqual(len(failures), 1)
        self.assertIn("시도를 정할 수 없는 주소 2건", failures[0])

    def test_건수가_하한_아래면_막는다(self):
        self.assertTrue(any("하한" in f for f in checks.check_pois(pois(extra=3), SIDOS, 10)))

    def test_문서_모양이_바뀌면_막는다(self):
        self.assertEqual(checks.check_pois({"items": []}, SIDOS, 0), ["proposals 목록이 없다 — 문서 모양이 바뀌었다"])

    def test_이름_없는_제안을_막는다(self):
        doc = pois(extra=10)
        doc["proposals"].append({"poi": {}, "provenance": {"address": "서울특별시 양천구 1"}})
        self.assertTrue(any("이름 없는 제안 1건" in f for f in checks.check_pois(doc, SIDOS, 10)))


class CheckEventsTest(unittest.TestCase):
    DAY = date(2026, 10, 10)

    def events(self, *spans):
        return {"events": [{"start": s, "end": e} for s, e in spans]}

    def test_그날_유효한_행사가_하한_이상이면_통과(self):
        self.assertEqual(checks.check_events(self.events(("2026-10-01", "2026-10-31")), self.DAY, 1), [])

    def test_전체_건수가_많아도_그날_유효한_것이_적으면_막는다_낡은_사본(self):
        stale = self.events(*[("2026-08-01", "2026-08-31")] * 400, ("2026-10-01", "2026-10-31"))
        failures = checks.check_events(stale, self.DAY, 30)
        self.assertEqual(len(failures), 1)
        self.assertIn("유효한 행사 1건 < 하한 30건 (전체 401건)", failures[0])

    def test_날짜가_깨진_행사는_유효로_세지_않는다(self):
        broken = {"events": [{"start": "2026-10-01"}, {"start": "어제", "end": "내일"}]}
        self.assertTrue(checks.check_events(broken, self.DAY, 1))

    def test_문서_모양이_바뀌면_막는다(self):
        self.assertEqual(checks.check_events({}, self.DAY, 0), ["events 목록이 없다 — 문서 모양이 바뀌었다"])


class CheckFreshnessTest(unittest.TestCase):
    NOW = datetime(2026, 10, 20, 9, 0, tzinfo=timezone(timedelta(hours=9)))

    def test_한도_안이면_통과(self):
        self.assertEqual(checks.check_freshness("2026-10-20T04:40:00+09:00", self.NOW, timedelta(hours=36)), [])

    def test_한도를_넘으면_알린다(self):
        self.assertTrue(checks.check_freshness("2026-10-18T04:40:00+09:00", self.NOW, timedelta(hours=36)))

    def test_수집_시각이_없으면_알린다(self):
        self.assertTrue(checks.check_freshness(None, self.NOW, timedelta(hours=36)))


if __name__ == "__main__":
    unittest.main()
