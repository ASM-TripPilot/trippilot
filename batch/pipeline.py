"""DAG 들이 함께 쓰는 경로·게시 — 두 DAG 에 같은 코드를 두면 원자 교체 규칙을 고칠 때 한쪽만 바뀐다."""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

BATCH = Path(__file__).resolve().parent
REPO = BATCH.parent
OUT = Path(os.environ.get("BATCH_OUTPUT", BATCH / ".out"))
PUBLISHED_MODE = 0o644
log = logging.getLogger(__name__)


def run_dir(dag_id: str, run_id: str) -> Path:
    """실행마다 `OUT/runs/<dag>/<run_id>/` 하나. Airflow 3.3.2 의 기본 run_id 패턴은 "."·".." 도 허용한다 — 그대로 이으면
    폴더가 runs/<dag> 나 runs/ 가 되고, 게시 뒤 정리가 다른 실행의 후보까지 지운다. 그 깊이가 아니면 거부한다."""
    root = (OUT / "runs").resolve()
    path = (root / dag_id / run_id.replace(":", "_")).resolve()
    if path.parent.parent != root:
        raise ValueError(f"run_id 로 실행 폴더를 만들 수 없다(runs/<dag>/<run_id> 가 아니다): {run_id!r}")
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
    clear_run(candidate.parent)
    return target


def clear_run(run: Path) -> None:
    """끝난 실행의 후보 폴더를 지운다. run_dir 이 만든 깊이의 폴더만 — runs/ 나 runs/<dag> 는 지우지 않는다."""
    run = run.resolve()
    if run.parent.parent == (OUT / "runs").resolve():
        # 게시는 이미 끝났다 — 정리 실패가 게시를 실패로 보이게 하면 안 된다(재실행이 성공한 게시를 다시 하게 된다).
        # 어떤 예외든 로그만 남긴다(onexc 는 3.12+ 라 쓰지 않는다 — 옛 인터프리터에서는 TypeError 가 게시 뒤에 났다).
        try:
            shutil.rmtree(run)
        except Exception as exc:
            log.warning("후보 정리 실패(게시는 끝났다): %s — %s", run, exc)


def run_day(context: dict, tz) -> datetime:
    """실행의 기준 날짜 — 날짜 없이 수동 트리거하면 Airflow 3 는 logical_date 를 context 에 넣지 않는다(실측)."""
    when = context.get("logical_date") or context["dag_run"].run_after
    return when.astimezone(tz)


def keep_run(run: Path, reason: str) -> None:
    """실패한 실행의 폴더를 남긴다 — 원인을 보고, 실패한 태스크부터 다시 돌릴 수 있게(게시 재시도는 그 복제본을 쓴다).
    실 수집 DAG 의 마지막 정리(`finish_run`)가 이 표시를 본다."""
    (run / "KEEP").write_text(reason, encoding="utf-8")


@contextmanager
def keep_on_failure(run: Path):
    """이 블록이 예외로 끝나면 실행 폴더를 남긴다(collect·validate·publish·persist — 재시도에 복제본이 필요한 태스크).
    들어올 때 지난 표시를 지운다 — 실패했던 태스크를 다시 돌려 성공하면, 정리(teardown)가 폴더를 지워야 한다."""
    (run / "KEEP").unlink(missing_ok=True)
    try:
        yield
    except BaseException as exc:
        keep_run(run, f"{type(exc).__name__}: {exc}")
        raise


def finish_run(run: Path) -> None:
    """실 수집 DAG 의 마지막 정리(teardown) — 앞 태스크가 어떻게 끝났든 돈다. 실패 표시가 있으면 남기고, 아니면 지운다
    (복제본이 실행마다 수백 MB 다)."""
    if (run / "KEEP").is_file():
        log.warning("실패한 실행 — 폴더를 남긴다: %s", run)
        return
    clear_run(run)


# ponytail: 남긴 실패 실행은 최근 KEPT_RUNS 개만 — 복제본이 수백 MB 라 매일 실패하면 emptyDir(10Gi)를 넘어 파드가 축출된다.
# 더 오래 봐야 하면 실패 원인을 태스크 로그로 남기고(이미 남는다) 이 수를 올리기보다 볼륨을 PVC 로 바꾼다.
KEPT_RUNS = 3
ORPHAN_AGE_S = 86400


def prune_runs(dag_id: str, current: Path) -> None:
    """새 실행을 시작할 때 같은 DAG 의 지난 실행 폴더를 정리한다. max_active_runs=1 이라 다른 실행이 쓰고 있지 않다.
    실패 실행은 최근 `KEPT_RUNS` 개만 남긴다. 표시 없는 폴더(정리 전에 파드가 죽은 실행)는 **하루 넘게 손대지 않은 것만**
    지운다 — `airflow dags test` 는 max_active_runs 를 따지지 않아, 방금 표시 없이 돌고 있는 실행일 수 있다."""
    root = (OUT / "runs" / dag_id).resolve()
    others = [d for d in root.iterdir() if d.is_dir() and d.resolve() != current.resolve()] if root.is_dir() else []
    kept = sorted((d for d in others if (d / "KEEP").is_file()), key=lambda d: (d / "KEEP").stat().st_mtime, reverse=True)
    stale = time.time() - ORPHAN_AGE_S
    for d in kept[KEPT_RUNS:] + [d for d in others if d not in kept and d.stat().st_mtime < stale]:
        clear_run(d)
