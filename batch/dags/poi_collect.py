"""POI 공유본 — 수집본 → 검증 → 게시. 검증이 실패하면 게시 태스크가 돌지 않는다(깨진 문서가 게시본을 못 덮는다).

실제 수집은 지금처럼 GitHub Actions(`ai-poi-collect.yml`)가 한다. 이 DAG 는 리포의 공유 수집본
(`ai/data/collected_pois.json`)을 수집 결과로 삼아, 검증 게이트를 게시 **앞에** 두는 구조를 로컬에서 돌린다
(실제 API 0건). 차이와 비교는 batch/README.md.
"""

from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from airflow.sdk import Param, dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402
import pipeline  # noqa: E402

SOURCE = pipeline.REPO / "ai/data/collected_pois.json"
PUBLISHED = pipeline.OUT / "published/collected_pois.json"


@dag(
    dag_id="poi_collect",
    schedule="0 4 * * *",   # KST 04:00 — ai-poi-collect.yml 과 같은 시각
    start_date=datetime(2026, 10, 1, tzinfo=ZoneInfo("Asia/Seoul")),
    catchup=False,
    max_active_runs=1,
    params={"min_count": Param(500, type="integer", minimum=0)},
    tags=["collect", "trippilot"],
)
def poi_collect():
    @task
    def collect() -> str:
        candidate = pipeline.run_dir("poi_collect", get_current_context()["run_id"]) / "collected_pois.json"
        shutil.copyfile(SOURCE, candidate)
        return str(candidate)

    @task
    def validate(candidate: str) -> str:
        doc = json.loads(pipeline.require_candidate(Path(candidate)).read_text(encoding="utf-8"))
        failures = checks.check_pois(doc, checks.sido_names(), get_current_context()["params"]["min_count"])
        if failures:
            # 재시도해도 같은 문서는 같은 결과다 — 실패로 끝내고 게시를 막는다.
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        return str(pipeline.publish(Path(candidate), PUBLISHED))

    publish(validate(collect()))


poi_collect()
