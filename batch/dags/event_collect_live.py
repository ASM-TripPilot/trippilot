"""행사 실 수집 — 저장소 복원 → 수집(네이버·LLM·큐레이션·TourAPI 축제) → **검증** → 게시(collect-state 영속). TRIP-1725.

ai-event-collect.yml 과 같은 스크립트·같은 순서다. 행사는 저장소(`collected_events.json`)가 곧 게시본이고 커서도 그 안에
있어, 게시 = collect-state 영속 하나다. Actions 판에는 영속 앞에 검증이 없다 — 여기서는 `checks.check_events`
(그날 유효 건수·가장 오래된 운영 지역의 마지막 수집)를 통과해야 영속한다. Actions 판은 영속 실패를 경고로 넘기지만
여기서는 실패다(초록불인 채 영속이 빠지면 아무도 모른다).

기본은 **그림자**(`BATCH_LIVE` 미설정): 실 API 를 부르지 않고 collect-state 의 저장소(= Actions 가 영속한 것)를 검증만 한다.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from airflow.sdk import Param, dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException, AirflowSkipException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402
import live  # noqa: E402
import pipeline  # noqa: E402

DAG_ID = "event_collect_live"
SEOUL = ZoneInfo("Asia/Seoul")
STORE = "collected_events.json"
log = logging.getLogger(__name__)


@dag(
    dag_id=DAG_ID,
    schedule="40 4 * * *",   # KST 04:40 — ai-event-collect.yml 과 같은 시각
    start_date=datetime(2026, 11, 1, tzinfo=SEOUL),
    catchup=False,
    max_active_runs=1,
    is_paused_upon_creation=True,
    # 기본값의 근거는 event_collect(로컬 DAG)의 Param 주석 — 같은 운영 수집을 본다.
    params={"min_valid_today": Param(30, type="integer", minimum=0),
            "max_age_days": Param(4, type="integer", minimum=0)},
    tags=["collect", "trippilot", "live"],
)
def event_collect_live():
    @task
    def collect() -> str:
        run = pipeline.run_dir(DAG_ID, get_current_context()["run_id"])
        repo = live.checkout(run / "repo")
        live.restore(repo, STORE)
        if live.live():
            live.require_key("NAVER_SEARCH_CLIENT_ID")
            store = {"EVENTS_STORE": STORE}
            live.collect(repo, "collect_events.py", env=store)
            live.collect(repo, "collect_curated_popups.py", "--store", STORE, env=store)
            try:   # Actions 판처럼 축제 실패는 위 수집분의 게시를 막지 않는다(continue-on-error)
                live.collect(repo, "collect_tourapi_festivals.py", "--store", STORE, env=store)
            except subprocess.CalledProcessError as exc:
                log.warning("TourAPI 축제 수집 실패 — 나머지 수집분은 그대로 검증·게시한다: %s", exc)
        return str(repo)

    @task
    def validate(repo: str) -> str:
        context = get_current_context()
        doc = json.loads(pipeline.require_candidate(Path(repo) / "ai" / STORE).read_text(encoding="utf-8"))
        failures = checks.check_events(doc, pipeline.run_day(context, SEOUL).date(), context["params"]["min_valid_today"],
                                       context["params"]["max_age_days"], checks.event_regions())
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return repo

    @task
    def publish(repo: str) -> str:
        if not live.live():
            pipeline.clear_run(Path(repo).parent)
            raise AirflowSkipException("그림자 모드 — 영속하지 않는다")
        commit = live.persist(Path(repo), STORE, f"chore(ai): 행사 저장소 갱신 — airflow {DAG_ID} (TRIP-421)")
        pipeline.clear_run(Path(repo).parent)
        return commit

    publish(validate(collect()))


event_collect_live()
