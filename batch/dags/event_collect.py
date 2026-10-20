"""행사 저장소 — 수집본 → 검증 → 게시. 검증은 **그날 유효한 행사 수**와 **가장 오래된 지역의 마지막 수집 뒤 지난 날수**를 본다.

2026-10-10(cce8c508): 수집은 매일 돌았는데 배포가 8월에 커밋된 사본을 구워, 그날 유효한 행사가 346건이 아니라
10건이었다. 전체 건수는 멀쩡했으므로 "그날 기준"으로 세야 잡힌다. 다만 유효 건수만으로는 늦다 — 사본에 미래 행사가
남아 있으면 수집이 멈춰도 몇 주 동안 하한 위에 머문다(2026-10-19 사본은 12-07 에야 빨개진다). 그래서 저장소의
`coverage`(지역별 마지막 수집 시각) 중 운영 수집 지역(수집기 `DEFAULT_REGIONS`)의 **가장 이른 것**(가장 오래 수집되지
않은 지역)이 `max_age_days`(기본 4일 — 근거는 아래 Param)보다 오래되면 같은 validate 에서 막는다.
이 DAG 는 리포의 행사 저장소(`ai/data/collected_events.json`)를 실행의 논리 날짜 기준으로 검증한다 — 리포 사본을
갱신하지 않으면 닷새째부터 매일 빨개지는 것이 의도다. 실제 수집은 GitHub Actions(`ai-event-collect.yml`), 실제 API 0건.
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
        # 4일 = 수집·검증 시차 1 + 폴백 1 + 하드캡 이월 1 + 여유 1. 운영 수집(ai-event-collect.yml → collect_events.py)은
        # vars.EVENT_REGIONS_PER_RUN=17 로 17개 지역을 **매일 전부** 돈다(NAVER_MAX_CALLS 하드캡 1000, `gh variable list` 2026-10-20).
        # - 시차 1: 04:40 의 validate 는 늘 **전날** 시각을 본다 — cron 이 늦게 돌고 시각은 실행 시작 때 찍혀, 운영 coverage 는
        #   04:40 뒤에 찍힌다(collect-state 실측 06:46~15:30 KST). 정상인 날도 하루 묵어 있다.
        # - 폴백 1: LLM 폴백한 지역은 coverage 를 찍지 않고 다음 날 다시 찍힌다(실측: 10-16 두 곳이 하루 늦었다).
        # - 하드캡 이월 1: 하드캡에 걸리면 남은 지역은 다음 날로 밀린다. 여유 1: GitHub 가 예약 실행을 한 번 건너뛰는 날 등.
        # 대가: 전체 정지를 닷새째에 잡고(유효 건수만으로는 7주 — 10-19 사본이 12-07 에야 빨개진다), 위 셋이 겹친 날까지 통과시킨다.
        # 지금 리포 사본(17곳 모두 2026-10-19 06:46)은 10-23 까지 통과하고 10-24 부터 빨개진다.
        # EVENT_REGIONS_PER_RUN 을 낮추면 한 지역이 r = ceil(17 / regions_per_run)일에 한 번 찍힌다 — 허용 = r(시차를 포함한 한 바퀴)
        # + r(폴백으로 놓친 한 바퀴) + 1(하드캡 이월) + 1(여유) = 2r + 2 일로 올린다(17/run 이면 r=1 → 4).
        "max_age_days": Param(4, type="integer", minimum=0),
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
        doc = json.loads(pipeline.require_candidate(Path(candidate)).read_text(encoding="utf-8"))
        failures = checks.check_events(doc, day, context["params"]["min_valid_today"],
                                       context["params"]["max_age_days"], checks.event_regions())
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        return str(pipeline.publish(Path(candidate), PUBLISHED))

    publish(validate(collect()))


event_collect()
