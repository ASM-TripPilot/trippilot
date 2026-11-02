"""POI 실 수집 — 수집(TourAPI) → 병합 → **검증** → 게시(공유본 PR 머지) → 커서 저장. 운영 이전 1단계(TRIP-1725).

ai-poi-collect.yml 과 같은 수집 스크립트·같은 순서다. 다른 점 셋:
- 검증(`checks.check_pois` + 축소 가드)이 게시 **앞의 태스크**다 — 실패하면 게시·커서 저장이 구조적으로 안 돈다.
- 커서 저장은 게시가 머지를 확인한 뒤에만 돈다(TRIP-1475 순서). 앞 태스크가 하나라도 실패·건너뛰면 돌지 않는다.
- 고정 IP(EKS NAT)에서 돈다 — 러너 IP 블랙홀 재시도 잡이 필요 없다.

기본은 **그림자**(`BATCH_LIVE` 미설정): 실 API 를 부르지 않고 그날 develop 의 공유본(= Actions 가 게시한 것)을 검증만 한다.
게시·커서 저장은 건너뛴다. 생성 시 paused — 켜는 것은 사람이다.
"""

from __future__ import annotations

import json
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

DAG_ID = "poi_collect_live"


@dag(
    dag_id=DAG_ID,
    schedule="0 4 * * *",   # KST 04:00 — ai-poi-collect.yml 과 같은 시각(Actions 스케줄을 끄고 넘겨받는다)
    start_date=datetime(2026, 11, 1, tzinfo=ZoneInfo("Asia/Seoul")),
    catchup=False,
    max_active_runs=1,       # 일일 호출 한도·collect-state 를 지키는 동시 1건(Actions 의 concurrency 와 같은 뜻)
    is_paused_upon_creation=True,
    params={"min_count": Param(500, type="integer", minimum=0)},
    tags=["collect", "trippilot", "live"],
)
def poi_collect_live():
    @task
    def collect() -> str:
        run = pipeline.run_dir(DAG_ID, get_current_context()["run_id"])
        repo = live.checkout(run / "repo")
        if live.live():
            live.require_key("TOUR_API_KEY")
            live.restore(repo, "collect_state.json")
            live.collect(repo, "collect_pois.py")
            (run / "merge.json").write_text(json.dumps(live.merge_pois(repo)), encoding="utf-8")
        return str(repo)

    @task
    def validate(repo: str) -> str:
        failures = []
        merge = Path(repo).parent / "merge.json"
        if merge.is_file():
            failures += [f for f in [live.shrink_failure(json.loads(merge.read_text(encoding="utf-8")))] if f]
        doc = json.loads(pipeline.require_candidate(Path(repo) / "ai/data/collected_pois.json").read_text(encoding="utf-8"))
        failures += checks.check_pois(doc, checks.sido_names(), get_current_context()["params"]["min_count"])
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return repo

    @task
    def publish(repo: str) -> str:
        if not live.live():
            pipeline.clear_run(Path(repo).parent)   # 검증까지 통과한 그림자 실행 — 복제본(수백 MB)을 남기지 않는다
            raise AirflowSkipException("그림자 모드 — 게시·커서 저장을 하지 않는다")
        return live.publish_pois(Path(repo), json.loads((Path(repo).parent / "merge.json").read_text(encoding="utf-8")))

    @task
    def persist_cursor(repo: str, published: str) -> str:
        commit = live.persist(Path(repo), "collect_state.json", f"chore(ai): 수집 상태 갱신 — airflow {DAG_ID} (TRIP-348)")
        pipeline.clear_run(Path(repo).parent)
        return commit

    checked = validate(collect())
    persist_cursor(checked, publish(checked))


poi_collect_live()
