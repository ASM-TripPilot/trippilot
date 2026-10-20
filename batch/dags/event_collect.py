"""행사 저장소 — 수집본 → 검증 → 게시. 검증은 **그날 유효한 행사 수**와 **마지막 수집 뒤 지난 날수**를 본다.

2026-10-10(cce8c508): 수집은 매일 돌았는데 배포가 8월에 커밋된 사본을 구워, 그날 유효한 행사가 346건이 아니라
10건이었다. 전체 건수는 멀쩡했으므로 "그날 기준"으로 세야 잡힌다. 다만 유효 건수만으로는 늦다 — 사본에 미래 행사가
남아 있으면 수집이 멈춰도 몇 주 동안 하한 위에 머문다(2026-10-19 사본은 12-07 에야 빨개진다). 그래서 저장소의
`coverage`(지역별 마지막 수집 시각) 중 가장 늦은 것이 `max_age_days` 보다 오래되면 같은 validate 에서 막는다.
이 DAG 는 리포의 행사 저장소(`ai/data/collected_events.json`)를 실행의 논리 날짜 기준으로 검증한다 — 리포 사본을
갱신하지 않으면 일주일 뒤부터 매일 빨개지는 것이 의도다. 실제 수집은 GitHub Actions(`ai-event-collect.yml`), 실제 API 0건.
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
    params={
        "min_valid_today": Param(30, type="integer", minimum=0),
        # 7일 — 운영 수집은 매일 3개 지역씩 돌아 17개 지역이 6일에 한 바퀴다. 가장 늦은 수집 시각이 한 바퀴(6일)보다
        # 오래됐다면 어느 지역도 수집되지 않은 것이다. 하루 여유를 더해 7일. 지금 사본(2026-10-19)은 10-26 까지 통과한다.
        "max_age_days": Param(7, type="integer", minimum=0),
    },
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
        failures = checks.check_events(doc, day, context["params"]["min_valid_today"],
                                       context["params"]["max_age_days"])
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        return str(pipeline.publish(Path(candidate), PUBLISHED))

    publish(validate(collect()))


event_collect()
