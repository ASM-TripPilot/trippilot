"""POI 수집 — 수집 → 검증 → 게시. 검증이 실패하면 게시 태스크가 돌지 않는다(깨진 문서가 정본을 못 덮는다).

운영 배치는 GitHub Actions(`ai-poi-collect.yml`)다. 이 DAG 는 로컬(compose `batch` 프로필)에서 같은 수집을
검증 게이트 뒤에 두는 파이프라인이다 — 차이와 비교는 batch/README.md.

- dry_run=True(기본): 실제 API 를 부르지 않고 리포의 공유 수집본(`ai/data/collected_pois.json`)을 수집 결과로 쓴다.
- dry_run=False: `ai/scripts/collect/collect_pois.py` 를 그대로 부른다 — TOUR_API_KEY 등이 환경에 있어야 하고
  하루 호출 한도를 쓴다. 상태 파일은 게시 폴더 옆에 둔다(git 의 collect-state 브랜치는 건드리지 않는다).
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

BATCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BATCH))
import checks  # noqa: E402

REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))
FIXTURE = REPO / "ai/data/collected_pois.json"
PUBLISHED = OUT / "published/collected_pois.json"


def run_dir() -> Path:
    path = OUT / "runs" / "poi_collect" / get_current_context()["run_id"].replace(":", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


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
    @task(retries=2)
    def collect() -> str:
        candidate = run_dir() / "collected_pois.json"
        if get_current_context()["params"]["dry_run"]:
            shutil.copyfile(FIXTURE, candidate)
        else:
            subprocess.run(
                ["uv", "run", "python", "scripts/collect/collect_pois.py"],
                cwd=REPO / "ai", check=True,
                env={**os.environ, "COLLECT_OUTPUT": str(candidate), "COLLECT_STATE": str(OUT / "collect_state.json")},
            )
        return str(candidate)

    @task
    def validate(candidate: str) -> str:
        doc = json.loads(Path(candidate).read_text(encoding="utf-8"))
        failures = checks.check_pois(doc, checks.Sidos.load(), get_current_context()["params"]["min_count"])
        if failures:
            # 재시도해도 같은 문서는 같은 결과다 — 실패로 끝내고 게시를 막는다.
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        PUBLISHED.parent.mkdir(parents=True, exist_ok=True)
        staging = PUBLISHED.with_suffix(".json.tmp")
        shutil.copyfile(candidate, staging)
        staging.replace(PUBLISHED)   # 원자적 교체 — 읽는 쪽이 반쯤 쓴 파일을 보지 않게
        return str(PUBLISHED)

    publish(validate(collect()))


poi_collect()
