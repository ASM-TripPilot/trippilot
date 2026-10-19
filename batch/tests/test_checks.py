"""수집 산출물 검증 — Airflow 없이 돈다. `python3 -m unittest discover -s batch/tests` (리포 루트에서)."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402

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


class CheckPoisTest(unittest.TestCase):
    def test_읽을_수_있는_문서는_통과(self):
        self.assertEqual(checks.check_pois(pois(extra=10), SIDOS, 10), [])

    def test_시도를_못_정하는_주소가_섞이면_게시를_막는다(self):
        failures = checks.check_pois(pois("부산광역 사하구 하단동 1195", "Tokyo, Japan", extra=10), SIDOS, 10)
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


if __name__ == "__main__":
    unittest.main()
