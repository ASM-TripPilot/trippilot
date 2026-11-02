"""POI 실 수집 — 수집(TourAPI) → 병합 → **검증** → 게시(공유본 PR 머지) → 커서 저장. 운영 이전 1단계(TRIP-1725).

ai-poi-collect.yml 과 같은 수집 스크립트·같은 순서다. 다른 점:
- 검증(`checks.check_pois` + 축소 가드)이 게시 **앞의 태스크**다 — 실패하면 게시·커서 저장이 구조적으로 안 돈다.
- 커서 저장은 게시가 머지를 확인한 뒤에만 돈다(TRIP-1475 순서). 앞 태스크가 하나라도 실패·건너뛰면 돌지 않는다.
- 신규율 정체 경보(`collect_novelty.py --fail-if-stalled`)는 병합 뒤 **곁가지 태스크**다 — 빨개져도 게시·커서 저장에
  닿지 않는다(Actions 판도 병합을 막지 않는 진단이다).
- 고정 IP(EKS NAT)에서 돈다 — 러너 IP 블랙홀 재시도 잡이 필요 없다.

기본은 **그림자**(`BATCH_LIVE` 미설정): 실 API 를 부르지 않고 그날 develop 의 공유본(= Actions 가 게시한 것)을 검증만 한다.
게시·커서 저장·신규율은 건너뛴다. 생성 시 paused — 켜는 것은 사람이다.
"""

from __future__ import annotations

import json
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

DAG_ID = "poi_collect_live"


def run_path() -> Path:
    return pipeline.run_dir(DAG_ID, get_current_context()["run_id"])


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
        run = run_path()
        pipeline.prune_runs(DAG_ID, run)
        with pipeline.keep_on_failure(run):
            repo = live.checkout(run / "repo")
            if live.live():
                live.require_key("TOUR_API_KEY")
                if live.restore(repo, "collect_state.json"):
                    # 신규율은 **이번 실행 전** 색인과 비교한다 — 수집기가 상태를 제자리에 덮어쓴다.
                    (repo / "ai/collect_state.prev.json").write_bytes((repo / "ai/collect_state.json").read_bytes())
                live.collect(repo, "collect_pois.py")
                (run / "merge.json").write_text(json.dumps(live.merge_pois(repo)), encoding="utf-8")
        return str(repo)

    @task
    def validate(repo: str) -> str:
        with pipeline.keep_on_failure(Path(repo).parent):
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
    def novelty(repo: str) -> None:
        """신규율 정체 경보 — 비차단. 실패해도 게시·커서 저장은 이 태스크를 기다리지 않는다."""
        if not live.live():
            raise AirflowSkipException("그림자 모드 — 수집하지 않았다")
        prev = Path(repo) / "ai/collect_state.prev.json"
        live.collect(Path(repo), "collect_novelty.py", "--output", "collected_pois.json",
                     *(["--prev-state", prev.name] if prev.is_file() else []), "--fail-if-stalled")

    @task
    def publish(repo: str) -> str:
        if not live.live():
            raise AirflowSkipException("그림자 모드 — 게시·커서 저장을 하지 않는다")
        # 실패하면 복제본을 남긴다 — 이 태스크만 지우고 다시 돌리면(clear) 그 복제본에서 push·머지 확인을 다시 한다.
        with pipeline.keep_on_failure(Path(repo).parent):
            return live.publish_pois(Path(repo), json.loads((Path(repo).parent / "merge.json").read_text(encoding="utf-8")))

    @task
    def persist_cursor(repo: str, published: str) -> str:
        with pipeline.keep_on_failure(Path(repo).parent):
            return live.persist(Path(repo), "collect_state.json", f"chore(ai): 수집 상태 갱신 — airflow {DAG_ID} (TRIP-348)")

    # teardown — 앞이 어떻게 끝났든 돌고, 실행의 성패에는 세지 않는다. 보통 태스크(all_done)로 두면 유일한 잎이라
    # 어떤 실패도 실행을 success 로 덮는다.
    @teardown
    def cleanup() -> None:
        pipeline.finish_run(run_path())

    repo = collect()
    checked = validate(repo)
    [persist_cursor(checked, publish(checked)), novelty(repo)] >> cleanup()


poi_collect_live()
