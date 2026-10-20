"""DAG 구조와 실행 — Airflow 가 설치된 환경에서만 돈다(없으면 건너뛴다).

    pip install "apache-airflow==3.3.2" --constraint <constraints-3.3.2/constraints-3.12.txt>
    export AIRFLOW_HOME=$(mktemp -d)       # 마이그레이션과 테스트가 같은 메타 DB 를 봐야 한다(한 줄에만 붙이면 테스트는 ~/airflow 를 본다)
    airflow db migrate && python3 -m unittest discover -s batch/tests

DAG 는 실제 API 를 부르지 않는다(POI 는 합성 문서, 행사는 리포 사본) — CI 실 호출 0건 규칙 안에서 돈다.
"""

import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

DAGS = Path(__file__).resolve().parents[1] / "dags"
EVENTS = Path(__file__).resolve().parents[2] / "ai/data/collected_events.json"
DAG_START = date(2026, 10, 1)
MAX_AGE_DAYS = 3   # event_collect 의 max_age_days 기본값
sys.path.insert(0, str(DAGS.parent))
import checks  # noqa: E402

REGIONS = checks.event_regions()


def coverage(stamp: str, **late) -> dict:
    """17개 운영 지역 모두 `stamp` 에 찍히고, `late` 로 준 지역만 그 시각 — 운영 수집은 매일 17곳 전부를 돈다."""
    return {r: late.get(r, stamp) for r in REGIONS}


def fixture_events() -> list[dict]:
    return json.loads(EVENTS.read_text(encoding="utf-8"))["events"]


def oldest_collected() -> date:
    """가장 오래된 지역의 마지막 수집 — event_collect 의 신선도 검사가 보는 값."""
    doc = json.loads(EVENTS.read_text(encoding="utf-8"))
    return min(datetime.fromisoformat(doc["coverage"][r]).date() for r in REGIONS)


def busiest_day() -> date:
    """리포 행사 사본에서 유효한 행사가 가장 많은 날 — DAG 시작일 이후이고, 가장 오래된 지역의 마지막 수집에서 허용 날수(MAX_AGE_DAYS) 안."""
    spans = [(date.fromisoformat(e["start"]), date.fromisoformat(e["end"])) for e in fixture_events()
             if e.get("start") and e.get("end")]
    first = max(DAG_START, oldest_collected())
    days = [first + timedelta(days=i) for i in range(MAX_AGE_DAYS + 1)]
    return max(days, key=lambda d: sum(s <= d <= e for s, e in spans))

# Airflow 를 불러오기 **전에** 정한다 — dag.test() 는 설정된 DAG 폴더를 메타 DB 에 동기화해서 돌고,
# 예제 DAG 까지 싣으면 우리와 무관한 의존성(kubernetes 등) 오류가 섞인다.
os.environ.setdefault("AIRFLOW__CORE__DAGS_FOLDER", str(DAGS))
os.environ.setdefault("AIRFLOW__CORE__LOAD_EXAMPLES", "False")

try:
    import airflow  # noqa: F401
except ImportError:  # pragma: no cover
    airflow = None


@unittest.skipIf(airflow is None, "Airflow 가 설치돼 있지 않다")
class DagStructureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from airflow.dag_processing.dagbag import DagBag
        cls.bag = DagBag(dag_folder=str(DAGS))

    def test_DAG_를_불러오는_오류가_없다(self):
        self.assertEqual(self.bag.import_errors, {})

    def test_검증이_게시보다_먼저다_깨진_문서가_정본을_못_덮는다(self):
        for dag_id in ("poi_collect", "event_collect"):
            dag = self.bag.get_dag(dag_id)
            self.assertEqual(dag.get_task("validate").upstream_task_ids, {"collect"}, dag_id)
            self.assertEqual(dag.get_task("publish").upstream_task_ids, {"validate"}, dag_id)

@unittest.skipIf(airflow is None, "Airflow 가 설치돼 있지 않다")
class DryRunTest(unittest.TestCase):
    """dag.test() 로 실제 태스크를 돌린다 — 수집(사본) → 검증 → 게시."""

    def setUp(self):
        self.out = Path(tempfile.mkdtemp())
        os.environ["BATCH_OUTPUT"] = str(self.out)
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)
        self.addCleanup(os.environ.pop, "BATCH_OUTPUT", None)

    def load(self, module):
        import importlib.util
        import sys
        # 공용 모듈은 출력 폴더(BATCH_OUTPUT)를 불러올 때 정한다 — 테스트마다 새 임시 폴더라 매번 새로 불러온다.
        for shared in ("pipeline", "checks"):
            sys.modules.pop(shared, None)
        spec = importlib.util.spec_from_file_location(module, DAGS / f"{module}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def poi_source(self, *addresses, ok=600):
        """합성 POI 공유본 — 리포 데이터 상태와 무관하게 게이트를 검사한다."""
        rows = [{"poi": {"name": f"p{i}"}, "provenance": {"address": "서울특별시 양천구 신정동 1"}} for i in range(ok)]
        rows += [{"poi": {"name": f"x{i}"}, "provenance": {"address": a}} for i, a in enumerate(addresses)]
        path = self.out / "source.json"
        path.write_text(json.dumps({"proposals": rows}, ensure_ascii=False), encoding="utf-8")
        return path

    def test_POI_검증을_거쳐_게시한다(self):
        mod = self.load("poi_collect")
        mod.SOURCE = self.poi_source()
        mod.poi_collect().test()
        self.assertEqual(len(json.loads((self.out / "published/collected_pois.json").read_text(encoding="utf-8"))["proposals"]), 600)
        self.assertEqual(list((self.out / "runs/poi_collect").iterdir()), [])   # 게시한 실행의 후보 사본은 지웠다

    def test_POI_백엔드가_못_읽는_주소가_섞이면_게시하지_않는다_1427(self):
        mod = self.load("poi_collect")
        mod.SOURCE = self.poi_source("부산광역 사하구 하단동 1195", "제주특별자치 서귀포시 색달동 3039-41")
        run = mod.poi_collect().test()
        states = {ti.task_id: ti.state for ti in run.get_task_instances()}
        self.assertEqual((states["collect"], states["validate"]), ("success", "failed"))
        self.assertFalse((self.out / "published/collected_pois.json").exists())
        kept = list((self.out / "runs/poi_collect").glob("*/collected_pois.json"))
        self.assertEqual(len(kept), 1)   # 검증에 실패한 후보는 원인을 보라고 남긴다

    def test_행사는_그날_기준으로_검증한다(self):
        # 날짜를 박지 않는다 — 수집기가 지난 행사를 지워 리포 사본이 바뀌면 고정 날짜는 언젠가 하한 아래로 떨어진다.
        # 사본에서 유효 행사가 가장 많은 날(시작일 뒤, 가장 오래된 지역의 마지막 수집에서 허용 날수 안 — 신선도 검사도 통과하는 날)을 고른다.
        mod = self.load("event_collect")
        mod.event_collect().test(logical_date=datetime.combine(busiest_day(), time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))
        self.assertTrue((self.out / "published/collected_events.json").exists())

    def event_source(self, events, coverage):
        source = self.out / "events.json"
        source.write_text(json.dumps({"events": events, "coverage": coverage}, ensure_ascii=False), encoding="utf-8")
        return source

    def run_events(self, mod, day):
        """event_collect 를 그날로 돌리고 (태스크 상태, validate 가 낸 실패 사유)를 돌려준다 — 사유는 check_events 를
        감싸 받는다(dag.test 는 태스크를 이 프로세스에서 돌린다). 상태만 보면 어느 규칙이 막았는지 모른다."""
        reasons = []
        real = mod.checks.check_events

        def spy(*args):
            reasons.extend(real(*args))
            return reasons

        with mock.patch.object(mod.checks, "check_events", spy):
            run = mod.event_collect().test(logical_date=datetime.combine(day, time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))
        return {ti.task_id: ti.state for ti in run.get_task_instances()}, reasons

    def test_행사는_오늘이_아니라_실행의_논리_날짜로_검증한다(self):
        # 행사도 수집도 논리 날짜(2026-10-02) 근처뿐이다 — validate 가 오늘(date.today()) 로 세면 유효 0건·수집 낡음으로
        # 막히고, 논리 날짜로 세야 게시된다. 2026-10-10 뒤의 어느 날에 돌려도 오늘과 논리 날짜가 갈린다.
        mod = self.load("event_collect")
        mod.SOURCE = self.event_source([{"start": "2026-10-01", "end": "2026-10-03"}] * 40,
                                       coverage("2026-10-02T04:00:00+09:00"))
        states, reasons = self.run_events(mod, date(2026, 10, 2))
        self.assertEqual(reasons, [])
        self.assertEqual(states["publish"], "success")
        self.assertTrue((self.out / "published/collected_events.json").exists())

    def test_행사가_낡은_사본이면_게시하지_않는다_cce8c508(self):
        # 합성 저장소 — 수집은 바로 그날 했는데(신선도 통과) 행사가 모두 지났다: 유효 건수 규칙 **하나만** 막는다.
        # 날짜는 DAG 시작일(2026-10-01) 뒤여야 한다 — 앞이면 태스크가 아예 돌지 않아 검증과 무관하게 게시본이 없다.
        mod = self.load("event_collect")
        day = date(2026, 10, 20)
        mod.SOURCE = self.event_source([{"start": "2026-08-01", "end": "2026-08-31"}] * 400,
                                       coverage("2026-10-20T04:00:00+09:00"))
        states, reasons = self.run_events(mod, day)
        self.assertEqual((states["collect"], states["validate"]), ("success", "failed"))
        self.assertEqual(len(reasons), 1, reasons)
        self.assertIn("유효한 행사 0건 < 하한 30건 (전체 400건)", reasons[0])
        self.assertFalse((self.out / "published/collected_events.json").exists())

    def test_행사_수집이_멈췄으면_유효_건수가_넉넉해도_게시하지_않는다(self):
        # 합성 저장소 — 그날 유효한 행사 40건(하한 30 위)인데 가장 오래된 지역(제주)의 마지막 수집이 나흘 전이다.
        # 다른 지역은 어제 수집했다(가장 늦은 것만 보면 통과한다) — 수집 시각 규칙 하나만 막는다.
        mod = self.load("event_collect")
        mod.SOURCE = self.event_source([{"start": "2026-10-01", "end": "2026-12-31"}] * 40,
                                       coverage("2026-10-19T04:40:00+09:00", 제주="2026-10-16T04:40:00+09:00"))
        states, reasons = self.run_events(mod, date(2026, 10, 20))
        self.assertEqual((states["collect"], states["validate"]), ("success", "failed"))
        self.assertEqual(len(reasons), 1, reasons)
        self.assertIn("가장 오래된 지역의 마지막 수집 2026-10-16 — 2026-10-20 기준 4일 전 > 허용 3일", reasons[0])
        self.assertFalse((self.out / "published/collected_events.json").exists())

if __name__ == "__main__":
    unittest.main()
