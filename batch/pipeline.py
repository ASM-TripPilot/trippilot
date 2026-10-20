"""DAG 들이 함께 쓰는 경로·게시 — 두 DAG 에 같은 코드를 두면 원자 교체 규칙을 고칠 때 한쪽만 바뀐다."""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

BATCH = Path(__file__).resolve().parent
REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))
PUBLISHED_MODE = 0o644
log = logging.getLogger(__name__)


def run_dir(dag_id: str, run_id: str) -> Path:
    path = OUT / "runs" / dag_id / run_id.replace(":", "_")
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_candidate(candidate: Path) -> Path:
    """validate·publish 가 받은 후보가 아직 있는가. 성공한 실행은 publish 가 후보 폴더를 지웠으므로, 그 실행의
    validate·publish 만 지우고(clear) 다시 돌리면 여기서 멈춘다 — 낯선 FileNotFoundError 대신 할 일을 말한다."""
    if not candidate.is_file():
        raise FileNotFoundError(f"후보가 없다 — 성공한 실행은 게시 뒤 후보를 지운다. collect 부터 다시 돌린다: {candidate}")
    return candidate


def publish(candidate: Path, target: Path) -> Path:
    """원자적 교체 — 읽는 쪽이 반쯤 쓴 파일을 보지 않게. 게시가 끝나면 그 실행의 후보 폴더(run_dir)를 지운다.

    - 임시 파일은 실행마다 고유한 이름이다 — 이름이 고정이면 동시에 두 게시가 서로의 임시 파일을 덮는다
      (`airflow dags test` 는 max_active_runs 를 따지지 않는다). 같은 폴더에 둬야 replace 가 원자적이다.
    - 후보 폴더는 실행마다 수십 MB(POI 사본 48.6MB)라 남기면 한 달에 1.5GB 가 쌓인다. 검증이 실패하면 게시가
      돌지 않으므로 실패한 실행의 후보는 그대로 남아 원인을 볼 수 있다."""
    require_candidate(candidate)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
    os.close(fd)
    staging = Path(name)
    try:
        shutil.copyfile(candidate, staging)
        # mkstemp 는 0600 으로 만들고 copyfile 은 권한을 옮기지 않는다 — 그대로 두면 게시본을 다른 사용자(컨테이너
        # uid 50000·호스트 사용자)가 못 읽는다. 고정 이름으로 열던 때(umask 022 → 0644)와 같은 값을 명시한다 —
        # umask 를 읽으려면 os.umask 를 바꿨다 되돌려야 해 프로세스 전체에 경합이 생긴다.
        os.chmod(staging, PUBLISHED_MODE)
        staging.replace(target)
    except BaseException:
        staging.unlink(missing_ok=True)
        raise
    if OUT / "runs" in candidate.parent.parents:   # run_dir 이 만든 폴더만 — 다른 경로의 후보는 지우지 않는다
        # 게시는 이미 끝났다 — 정리 실패가 게시를 실패로 보이게 하면 안 된다(재실행이 성공한 게시를 다시 하게 된다).
        shutil.rmtree(candidate.parent, onexc=lambda _f, path, exc: log.warning("후보 정리 실패(게시는 끝났다): %s — %s", path, exc))
    return target


def run_day(context: dict, tz) -> datetime:
    """실행의 기준 날짜 — 날짜 없이 수동 트리거하면 Airflow 3 는 logical_date 를 context 에 넣지 않는다(실측)."""
    when = context.get("logical_date") or context["dag_run"].run_after
    return when.astimezone(tz)
