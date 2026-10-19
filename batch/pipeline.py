"""DAG 들이 함께 쓰는 경로·게시 — 두 DAG 에 같은 코드를 두면 원자 교체 규칙을 고칠 때 한쪽만 바뀐다."""

from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path

BATCH = Path(__file__).resolve().parent
REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))


def published(name: str, dry_run: bool) -> Path:
    """게시 위치 — 드라이런은 따로 둔다. 같은 곳에 두면 스케줄 드라이런이 실제 수집 게시본을 리포 사본으로 되돌리고
    (커서는 그대로라 그 사이 실제 수집분이 영영 다시 안 들어온다), 신선도 감시가 리포 사본의 나이를 재게 된다."""
    return OUT / ("dry-run" if dry_run else "published") / name


def run_dir(dag_id: str, run_id: str) -> Path:
    path = OUT / "runs" / dag_id / run_id.replace(":", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


def publish(candidate: Path, target: Path) -> Path:
    """원자적 교체 — 읽는 쪽이 반쯤 쓴 파일을 보지 않게."""
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_suffix(target.suffix + ".tmp")
    shutil.copyfile(candidate, staging)
    staging.replace(target)
    return target


def run_day(context: dict, tz) -> datetime:
    """실행의 기준 날짜 — 날짜 없이 수동 트리거하면 Airflow 3 는 logical_date 를 context 에 넣지 않는다(실측)."""
    when = context.get("logical_date") or context["dag_run"].run_after
    return when.astimezone(tz)
