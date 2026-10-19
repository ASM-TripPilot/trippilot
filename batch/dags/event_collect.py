"""행사 수집 — 수집 → 검증 → 게시, 그리고 매시 신선도 감시.

2026-10-10(cce8c508): 수집은 매일 돌았는데 배포가 8월 사본을 구워, 그날 유효한 행사가 346건이 아니라 10건이었다.
그때 배포에 넣은 두 가드("깨지면 멈춤 · 늙으면 경고")를 여기서는 태스크로 둔다 — 검증(validate)이 깨진 문서의
게시를 막고, 신선도 DAG(event_freshness)가 수집이 조용히 멈춘 것을 알린다.

- dry_run=True(기본): 리포의 행사 저장소(`ai/data/collected_events.json`)를 수집 결과로 쓴다. 검증의 "오늘"은
  실행의 논리 날짜(logical date)라, 과거 날짜로 백필하면 그날 기준으로 판정한다.
- dry_run=False: 게시본(없으면 리포 사본)을 저장소로 삼아 `collect_events.py`·`collect_tourapi_festivals.py` 를
  부른다 — 네이버·카카오·Azure OpenAI·TourAPI 키가 환경에 있어야 한다.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from airflow.sdk import Param, dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException

BATCH = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BATCH))
import checks  # noqa: E402

REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))
FIXTURE = REPO / "ai/data/collected_events.json"
PUBLISHED = OUT / "published/collected_events.json"
SEOUL = ZoneInfo("Asia/Seoul")


def run_dir() -> Path:
    path = OUT / "runs" / "event_collect" / get_current_context()["run_id"].replace(":", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


@dag(
    dag_id="event_collect",
    schedule="40 4 * * *",   # KST 04:40 — ai-event-collect.yml 과 같은 시각
    start_date=datetime(2026, 10, 1, tzinfo=SEOUL),
    catchup=False,
    params={
        "dry_run": Param(True, type="boolean"),
        "min_valid_today": Param(30, type="integer", minimum=0),
    },
    tags=["collect", "trippilot"],
)
def event_collect():
    @task(retries=2)
    def collect() -> str:
        candidate = run_dir() / "collected_events.json"
        shutil.copyfile(PUBLISHED if PUBLISHED.exists() else FIXTURE, candidate)
        if not get_current_context()["params"]["dry_run"]:
            env = {**os.environ, "EVENTS_STORE": str(candidate)}
            for script in (["scripts/collect/collect_events.py"],
                           ["scripts/collect/collect_tourapi_festivals.py", "--store", str(candidate)]):
                subprocess.run(["uv", "run", "python", *script], cwd=REPO / "ai", check=True, env=env)
        return str(candidate)

    @task
    def validate(candidate: str) -> str:
        context = get_current_context()
        day = context["logical_date"].astimezone(SEOUL).date()
        doc = json.loads(Path(candidate).read_text(encoding="utf-8"))
        failures = checks.check_events(doc, day, context["params"]["min_valid_today"])
        if failures:
            raise AirflowFailException("게시 중단 — " + " / ".join(failures))
        return candidate

    @task
    def publish(candidate: str) -> str:
        PUBLISHED.parent.mkdir(parents=True, exist_ok=True)
        staging = PUBLISHED.with_suffix(".json.tmp")
        shutil.copyfile(candidate, staging)
        staging.replace(PUBLISHED)
        return str(PUBLISHED)

    publish(validate(collect()))


@dag(
    dag_id="event_freshness",
    schedule="0 * * * *",
    start_date=datetime(2026, 10, 1, tzinfo=SEOUL),
    catchup=False,
    params={"max_age_hours": Param(36, type="integer", minimum=1)},
    tags=["collect", "trippilot", "freshness"],
)
def event_freshness():
    @task
    def check() -> None:
        if not PUBLISHED.exists():
            raise AirflowFailException(f"게시된 행사 저장소가 없다: {PUBLISHED}")
        events = json.loads(PUBLISHED.read_text(encoding="utf-8")).get("events") or []
        latest = max((e.get("collected_at") for e in events if e.get("collected_at")), default=None)
        failures = checks.check_freshness(
            latest, datetime.now(SEOUL), timedelta(hours=get_current_context()["params"]["max_age_hours"]),
        )
        if failures:
            raise AirflowFailException(" / ".join(failures))

    check()


event_collect()
event_freshness()
