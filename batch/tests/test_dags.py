"""DAG 구조와 드라이런 — Airflow 가 설치된 환경에서만 돈다(없으면 건너뛴다).

    pip install "apache-airflow==3.3.2" --constraint <constraints-3.3.2/constraints-3.12.txt>
    AIRFLOW_HOME=$(mktemp -d) airflow db migrate          # 드라이런 테스트가 메타 DB 를 쓴다
    python3 -m unittest discover -s batch/tests

드라이런은 실제 API 를 부르지 않는다(리포의 수집본을 수집 결과로 쓴다) — CI 실 호출 0건 규칙 안에서 돈다.
"""

import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

DAGS = Path(__file__).resolve().parents[1] / "dags"

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

    def test_기본은_드라이런이다(self):
        for dag_id in ("poi_collect", "event_collect"):
            self.assertIs(self.bag.get_dag(dag_id).params["dry_run"], True, dag_id)

    def test_신선도_DAG_가_있다(self):
        self.assertIn("event_freshness", self.bag.dag_ids)


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
        spec = importlib.util.spec_from_file_location(module, DAGS / f"{module}.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_POI_드라이런은_검증을_거쳐_게시한다(self):
        mod = self.load("poi_collect")
        mod.poi_collect().test()
        published = self.out / "published/collected_pois.json"
        self.assertTrue(published.exists())
        self.assertGreater(len(json.loads(published.read_text(encoding="utf-8"))["proposals"]), 500)

    def test_행사_드라이런은_그날_기준으로_검증한다(self):
        mod = self.load("event_collect")
        mod.event_collect().test(logical_date=datetime(2026, 10, 20, 4, 40, tzinfo=ZoneInfo("Asia/Seoul")))
        self.assertTrue((self.out / "published/collected_events.json").exists())

    def test_행사가_낡았으면_게시하지_않는다(self):
        # 리포 사본의 마지막 행사는 2027-05-14 에 끝난다 — 2028년 날짜로 돌리면 그날 유효한 행사가 0건이라 사본이
        # 그날에 비해 낡은 것이다(cce8c508 과 같은 모양). 날짜는 DAG 시작일(2026-10-01) 뒤여야 한다 — 앞이면 태스크가
        # 아예 돌지 않아 검증과 무관하게 게시본이 없다(실측: 처음 2025년으로 썼다가 검증을 지워도 통과했다).
        mod = self.load("event_collect")
        run = mod.event_collect().test(logical_date=datetime(2028, 1, 1, 4, 40, tzinfo=ZoneInfo("Asia/Seoul")))
        states = {ti.task_id: ti.state for ti in run.get_task_instances()}
        self.assertEqual(states["collect"], "success")    # 수집은 됐다
        self.assertEqual(states["validate"], "failed")    # 검증이 막았다
        self.assertFalse((self.out / "published/collected_events.json").exists())


if __name__ == "__main__":
    unittest.main()
