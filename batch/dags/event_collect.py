"""행사 저장소 — 수집본 → 검증 → 게시. 검증은 **그날 유효한 행사 수**를 본다.

2026-10-10(cce8c508): 수집은 매일 돌았는데 배포가 8월에 커밋된 사본을 구워, 그날 유효한 행사가 346건이 아니라
10건이었다. 전체 건수는 멀쩡했으므로 "그날 기준"으로 세야 잡힌다. 이 DAG 는 리포의 행사 저장소
(`ai/data/collected_events.json`)를 실행의 논리 날짜 기준으로 검증한다 — 리포 사본이 낡으면 매일 실행이 빨개지는 것이
의도다(사본을 갱신하라는 신호). 실제 수집은 GitHub Actions(`ai-event-collect.yml`), 실제 API 0건.
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

SOURCE = pipeline.REPO / "ai/data/collected_events.json"
PUBLISHED = pipeline.OUT / "published/collected_events.json"
SEOUL = ZoneInfo("Asia/Seoul")


@dag(
    dag_id="event_collect",
    schedule="40 4 * * *",   # KST 04:40 — ai-event-collect.yml 과 같은 시각
    start_date=datetime(2026, 10, 1, tzinfo=SEOUL),
    catchup=False,
    max_active_runs=1,
    params={"min_valid_today": Param(30, type="integer", minimum=0)},
    tags=["collect", "trippilot"],
)
def event_collect():
    @task
    def collect() -> str:
        candidate = pipeline.run_dir("event_collect", get_current_context()["run_id"]) / "collected_events.json"
        shutil.copyfile(SOURCE, candidate)
        return str(candidate)

    @task
    def validate(candidate: str) -> str:
        context = get_current_context()
        day = pipeline.run_day(context, SEOUL).date()
        doc = json.loads(Path(candidate).read_text(encoding="utf-8"))
        failures = checks.check_events(doc, day, context["params"]["min_valid_today"])
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        return str(pipeline.publish(Path(candidate), PUBLISHED))

    publish(validate(collect()))


event_collect()
