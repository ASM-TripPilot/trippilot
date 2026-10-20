"""DAG 들이 함께 쓰는 경로·게시 — 두 DAG 에 같은 코드를 두면 원자 교체 규칙을 고칠 때 한쪽만 바뀐다."""

from __future__ import annotations

import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

BATCH = Path(__file__).resolve().parent
REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))


def run_dir(dag_id: str, run_id: str) -> Path:
    path = OUT / "runs" / dag_id / run_id.replace(":", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


def publish(candidate: Path, target: Path) -> Path:
    """원자적 교체 — 읽는 쪽이 반쯤 쓴 파일을 보지 않게. 게시가 끝나면 그 실행의 후보 폴더(run_dir)를 지운다.

    - 임시 파일은 실행마다 고유한 이름이다 — 이름이 고정이면 동시에 두 게시가 서로의 임시 파일을 덮는다
      (`airflow dags test` 는 max_active_runs 를 따지지 않는다). 같은 폴더에 둬야 replace 가 원자적이다.
    - 후보 폴더는 실행마다 수십 MB(POI 사본 48.6MB)라 남기면 한 달에 1.5GB 가 쌓인다. 검증이 실패하면 게시가
      돌지 않으므로 실패한 실행의 후보는 그대로 남아 원인을 볼 수 있다."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    os.close(fd)
    staging = Path(name)
    try:
        shutil.copyfile(candidate, staging)
        staging.replace(target)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    if OUT / "runs" in candidate.parent.parents:   # run_dir 이 만든 폴더만 — 다른 경로의 후보는 지우지 않는다
        shutil.rmtree(candidate.parent)
    return target


def run_day(context: dict, tz) -> datetime:
    """실행의 기준 날짜 — 날짜 없이 수동 트리거하면 Airflow 3 는 logical_date 를 context 에 넣지 않는다(실측)."""
    when = context.get("logical_date") or context["dag_run"].run_after
    return when.astimezone(tz)
