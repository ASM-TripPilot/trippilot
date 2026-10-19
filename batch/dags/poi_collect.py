"""POI 수집 — 수집 → 검증 → 게시. 검증이 실패하면 게시 태스크가 돌지 않는다(깨진 문서가 정본을 못 덮는다).

운영 배치는 GitHub Actions(`ai-poi-collect.yml`)다. 이 DAG 는 로컬(compose `batch` 프로필)에서 같은 수집을
검증 게이트 뒤에 두는 파이프라인이다 — 차이와 비교는 batch/README.md.

- dry_run=True(기본): 실제 API 를 부르지 않고 리포의 공유 수집본(`ai/data/collected_pois.json`)을 수집 결과로 쓴다.
- dry_run=False: `collect_pois.py` 로 한 번 분량을 수집하고, 게시본(없으면 리포 공유본)에 `merge_pois_docs.py` 로
  **병합한** 문서를 후보로 삼는다 — 한 번 분량은 변경분뿐이라 그대로 게시하면 공유본이 수백 건으로 줄어든다.
  TOUR_API_KEY 등이 환경에 있어야 하고 하루 호출 한도를 쓴다. 수집 상태(커서)는 게시가 성공한 뒤에만 반영한다 —
  먼저 반영하면 검증에서 막힌 제안이 "기제안"으로 남아 다시 수집되지 않는다.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from airflow.sdk import Param, dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import checks  # noqa: E402
import pipeline  # noqa: E402

FIXTURE = pipeline.REPO / "ai/data/collected_pois.json"
PUBLISHED = pipeline.OUT / "published/collected_pois.json"
STATE = pipeline.OUT / "collect_state.json"


@dag(
    dag_id="poi_collect",
    schedule="0 4 * * *",   # KST 04:00 — ai-poi-collect.yml 과 같은 시각
    start_date=datetime(2026, 10, 1, tzinfo=ZoneInfo("Asia/Seoul")),
    catchup=False,
    params={
        "dry_run": Param(True, type="boolean"),
        "min_count": Param(500, type="integer", minimum=0),
    },
    tags=["collect", "trippilot"],
)
def poi_collect():
    @task
    def collect() -> str:
        # 재시도하지 않는다 — 실제 모드의 재시도는 하루 호출 한도를 그만큼 더 쓴다.
        context = get_current_context()
        work = pipeline.run_dir("poi_collect", context["run_id"])
        candidate = work / "collected_pois.json"
        if context["params"]["dry_run"]:
            shutil.copyfile(FIXTURE, candidate)
            return str(candidate)
        delta, state = work / "delta.json", work / "collect_state.json"
        if STATE.exists():
            shutil.copyfile(STATE, state)
        ai = pipeline.REPO / "ai"
        subprocess.run(["uv", "run", "python", "scripts/collect/collect_pois.py"], cwd=ai, check=True,
                       env={**os.environ, "COLLECT_OUTPUT": str(delta), "COLLECT_STATE": str(state)})
        base = PUBLISHED if PUBLISHED.exists() else FIXTURE
        subprocess.run(["uv", "run", "python", "scripts/collect/merge_pois_docs.py", "-o", str(candidate),
                        str(base), str(delta)], cwd=ai, check=True)
        return str(candidate)

    @task
    def validate(candidate: str) -> str:
        doc = json.loads(Path(candidate).read_text(encoding="utf-8"))
        failures = checks.check_pois(doc, checks.sido_names(), get_current_context()["params"]["min_count"])
        if failures:
            # 재시도해도 같은 문서는 같은 결과다 — 실패로 끝내고 게시를 막는다.
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        target = pipeline.publish(Path(candidate), PUBLISHED)
        state = Path(candidate).with_name("collect_state.json")
        if state.exists():
            pipeline.publish(state, STATE)   # 게시가 끝난 뒤에만 커서를 옮긴다
        return str(target)

    publish(validate(collect()))


poi_collect()
