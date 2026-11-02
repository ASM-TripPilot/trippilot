"""행사 실 수집 — 저장소 복원 → 수집(네이버·LLM·큐레이션·TourAPI 축제) → 검증 → 게시(collect-state 영속) → 신선도 경보. TRIP-1725.

ai-event-collect.yml 과 같은 스크립트·같은 순서다. 행사는 저장소(`collected_events.json`)가 곧 게시본이고 커서(지역
로테이션 포인터·coverage)도 그 안에 있어, 게시 = collect-state 영속 하나다.

검증은 둘로 나뉜다.
- **영속 앞(validate)**: 저장소가 깨졌는가 — 문서 모양·그날 유효 건수(`checks.check_event_store`). Actions 판에는 없다.
- **영속 뒤(freshness)**: 수집이 멈췄는가 — 가장 오래된 운영 지역의 마지막 수집(`checks.check_event_freshness`). 영속을
  막지 않는 경보다. 막으면 교착이다: 폴백이 이어져 coverage 가 안 찍히는 동안 포인터·coverage 도 영속되지 않아, 원인이
  풀려도 같은 낡은 저장소에서 다시 시작하고 신선도가 영영 회복되지 않는다. Actions 판처럼 포인터는 전진하고 빨간불만 켠다.

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

from airflow.sdk import Param, dag, get_current_context, task, teardown
from airflow.sdk.exceptions import AirflowFailException, AirflowSkipException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402
import live  # noqa: E402
import pipeline  # noqa: E402

DAG_ID = "event_collect_live"
SEOUL = ZoneInfo("Asia/Seoul")
STORE = "collected_events.json"
log = logging.getLogger(__name__)


def run_path() -> Path:
    return pipeline.run_dir(DAG_ID, get_current_context()["run_id"])


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
        run = run_path()
        pipeline.prune_runs(DAG_ID, run)
        with pipeline.keep_on_failure(run):
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

    def store_doc(repo: str) -> dict:
        return json.loads(pipeline.require_candidate(Path(repo) / "ai" / STORE).read_text(encoding="utf-8"))

    @task
    def validate(repo: str) -> str:
        with pipeline.keep_on_failure(Path(repo).parent):
            context = get_current_context()
            failures = checks.check_event_store(store_doc(repo), pipeline.run_day(context, SEOUL).date(),
                                                context["params"]["min_valid_today"])
            if failures:
                raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return repo

    @task
    def publish(repo: str) -> str:
        if not live.live():
            raise AirflowSkipException("그림자 모드 — 영속하지 않는다")
        with pipeline.keep_on_failure(Path(repo).parent):   # 실패하면 남긴다 — publish 만 다시 돌리면 같은 저장소를 영속한다
            return live.persist(Path(repo), STORE, f"chore(ai): 행사 저장소 갱신 — airflow {DAG_ID} (TRIP-421)")

    @task(trigger_rule="none_failed")   # 그림자(publish 건너뜀)에서도 돈다. 영속이 실패하면 돌 이유가 없다
    def freshness(repo: str) -> None:
        context = get_current_context()
        failures = checks.check_event_freshness(store_doc(repo), pipeline.run_day(context, SEOUL).date(),
                                                context["params"]["max_age_days"], checks.event_regions())
        if failures:
            where = "저장소는 이미 영속했다" if live.live() else "그림자 — Actions 가 영속한 저장소"
            raise AirflowFailException(f"행사 수집 정체 경보({where}) — " + " / ".join(failures))

    @teardown   # 실행의 성패에 세지 않는다 — 보통 태스크로 두면 유일한 잎이라 경보 실패를 success 로 덮는다
    def cleanup() -> None:
        pipeline.finish_run(run_path())

    checked = validate(collect())
    publish(checked) >> freshness(checked) >> cleanup()

event_collect_live()
