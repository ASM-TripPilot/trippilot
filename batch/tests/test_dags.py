"""DAG 구조와 실행 — Airflow 가 설치된 환경에서만 돈다(없으면 건너뛴다).

    pip install "apache-airflow==3.3.2" --constraint <constraints-3.3.2/constraints-3.12.txt>
    AIRFLOW_HOME=$(mktemp -d) airflow db migrate          # 실행 테스트가 메타 DB 를 쓴다
    python3 -m unittest discover -s batch/tests

DAG 는 실제 API 를 부르지 않는다(POI 는 합성 문서, 행사는 리포 사본) — CI 실 호출 0건 규칙 안에서 돈다.
"""

import json
import os
import shutil
import tempfile
import unittest
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

DAGS = Path(__file__).resolve().parents[1] / "dags"
EVENTS = Path(__file__).resolve().parents[2] / "ai/data/collected_events.json"
DAG_START = date(2026, 10, 1)


def fixture_events() -> list[dict]:
    return json.loads(EVENTS.read_text(encoding="utf-8"))["events"]


def busiest_day() -> date:
    """리포 행사 사본에서 유효한 행사가 가장 많은 날 — DAG 시작일 이후로."""
    spans = [(date.fromisoformat(e["start"]), date.fromisoformat(e["end"])) for e in fixture_events()
             if e.get("start") and e.get("end")]
    days = {max(s, DAG_START) for s, _ in spans}
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

    def test_POI_백엔드가_못_읽는_주소가_섞이면_게시하지_않는다_1427(self):
        mod = self.load("poi_collect")
        mod.SOURCE = self.poi_source("부산광역 사하구 하단동 1195", "제주특별자치 서귀포시 색달동 3039-41")
        run = mod.poi_collect().test()
        states = {ti.task_id: ti.state for ti in run.get_task_instances()}
        self.assertEqual((states["collect"], states["validate"]), ("success", "failed"))
        self.assertFalse((self.out / "published/collected_pois.json").exists())

    def test_행사는_그날_기준으로_검증한다(self):
        # 날짜를 박지 않는다 — 수집기가 지난 행사를 지워 리포 사본이 바뀌면 고정 날짜는 언젠가 하한 아래로 떨어진다.
        # 사본에서 유효 행사가 가장 많은 날(시작일 뒤)을 고른다.
        mod = self.load("event_collect")
        mod.event_collect().test(logical_date=datetime.combine(busiest_day(), time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))
        self.assertTrue((self.out / "published/collected_events.json").exists())

    def test_행사가_낡았으면_게시하지_않는다(self):
        # 리포 사본의 마지막 종료일 다음 날로 돌리면 그날 유효한 행사가 0건 — 사본이 그날에 비해 낡은 것이다
        # (cce8c508 과 같은 모양). 날짜는 DAG 시작일(2026-10-01) 뒤여야 한다 — 앞이면 태스크가 아예 돌지 않아
        # 검증과 무관하게 게시본이 없다(실측: 처음 2025년으로 썼다가 검증을 지워도 통과했다).
        mod = self.load("event_collect")
        after_all = max(date.fromisoformat(e["end"]) for e in fixture_events() if e.get("end")) + timedelta(days=1)
        run = mod.event_collect().test(logical_date=datetime.combine(after_all, time(4, 40), tzinfo=ZoneInfo("Asia/Seoul")))
        states = {ti.task_id: ti.state for ti in run.get_task_instances()}
        self.assertEqual(states["collect"], "success")    # 수집은 됐다
        self.assertEqual(states["validate"], "failed")    # 검증이 막았다
        self.assertFalse((self.out / "published/collected_events.json").exists())


if __name__ == "__main__":
    unittest.main()
