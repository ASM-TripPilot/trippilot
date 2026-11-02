"""실 수집 DAG(`poi_collect_live`·`event_collect_live`)의 리포·수집 상태 조작 — 운영 이전 1단계(TRIP-1725).

GitHub Actions(`ai-poi-collect.yml`·`ai-event-collect.yml`)가 셸로 하던 일을 **같은 순서로** 옮겼다 — 수집 스크립트는
그대로 부르고(ai/scripts/collect), 리포 복제·collect-state 복원·공유본 PR·상태 영속만 여기서 한다. 워크플로의 그 스텝을
고치면 여기도 맞출 것(Actions 를 끄기 전까지 둘이 함께 있다).

**모드는 `BATCH_LIVE` 하나로 갈린다.** 기본은 그림자 — 실 API 를 부르지 않고 게시·영속도 하지 않는다. 같은 시각에
Actions 가 이미 실 수집을 하므로, 둘 다 실 수집하면 일일 한도를 두 번 쓰고 collect-state 를 서로 덮는다.
Actions 스케줄을 끈 뒤에만 `BATCH_LIVE=1` 로 켠다.

Airflow 에 의존하지 않는다 — 실패는 보통 예외로 올리고, 어떤 예외를 "재시도 없는 실패"로 볼지는 DAG 가 정한다.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import subprocess
import time
from pathlib import Path

log = logging.getLogger(__name__)

STATE_BRANCH = "collect-state"
SYNC_BRANCH = "chore/poi-data-sync"
BOT = ("github-actions[bot]", "41898282+github-actions[bot]@users.noreply.github.com")   # Actions 판과 같은 작성자


def live() -> bool:
    return os.environ.get("BATCH_LIVE") == "1"


def git_env() -> dict[str, str]:
    """GitHub 토큰은 URL 이 아니라 요청 헤더로 넘긴다 — URL 에 넣으면 복제본의 .git/config 에 평문으로 남는다."""
    env = {**os.environ, "GIT_AUTHOR_NAME": BOT[0], "GIT_AUTHOR_EMAIL": BOT[1],
           "GIT_COMMITTER_NAME": BOT[0], "GIT_COMMITTER_EMAIL": BOT[1], "GIT_TERMINAL_PROMPT": "0"}
    token = os.environ.get("GH_TOKEN")
    if token:
        basic = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env |= {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {basic}"}
    return env


def sh(args: list[str], cwd: Path, check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    log.info("$ %s", " ".join(args))
    return subprocess.run(args, cwd=cwd, env=kwargs.pop("env", None) or git_env(), check=check, text=True, **kwargs)


def out(args: list[str], cwd: Path, **kwargs) -> str:
    return sh(args, cwd, capture_output=True, **kwargs).stdout.strip()


def checkout(dest: Path) -> Path:
    """develop 의 얕은 복제 + ai 의존성. 실행마다 새로 받는다 — 공유본·수집기가 그날 develop 의 것이어야 한다."""
    url = os.environ.get("BATCH_REPO_URL", "https://github.com/ASM-TripPilot/trippilot.git")
    shutil.rmtree(dest, ignore_errors=True)   # 같은 실행의 재시도가 반쯤 받은 복제를 남겼을 수 있다
    sh(["git", "clone", "--depth", "1", "--branch", "develop", "--single-branch", url, str(dest)], dest.parent)
    sh(["uv", "sync", "--locked"], dest / "ai")
    return dest


def restore(repo: Path, name: str) -> bool:
    """collect-state 브랜치의 `name` → `ai/<name>`. 워크플로의 복원 스텝과 같은 판정이다:
    - 브랜치가 없다 → 처음부터(False). 단 Actions 판과 달리 **조회 실패는 실패**다 — 네트워크 한 번에 처음부터 돌면
      커서·색인을 잃은 채 영속까지 간다(`ls-remote --exit-code` 는 브랜치가 없을 때만 2).
    - 있었는데 지금 tip 에 없다 → 유실(누가 트리를 덮었다), 실패.
    - 임시 파일에 받아 성공했을 때만 자리에 놓는다 — `git show > 파일` 은 실패해도 빈 파일을 남긴다(TRIP-348 회귀)."""
    target = repo / "ai" / name
    found = sh(["git", "ls-remote", "--exit-code", "--heads", "origin", STATE_BRANCH], repo, check=False,
               capture_output=True)
    if found.returncode == 2:
        log.info("collect-state 브랜치 없음 — 처음부터")
        return False
    if found.returncode != 0:
        raise RuntimeError(f"collect-state 조회 실패(종료 {found.returncode}) — 처음부터 돌지 않는다: {found.stderr.strip()}")
    sh(["git", "fetch", "--quiet", "origin", STATE_BRANCH], repo)
    shown = sh(["git", "show", f"FETCH_HEAD:{name}"], repo, check=False, capture_output=True)
    if shown.returncode == 0:
        target.write_text(shown.stdout, encoding="utf-8")
        return True
    if out(["git", "rev-list", "-1", "FETCH_HEAD", "--", f":(top){name}"], repo):
        raise RuntimeError(f"{name} 유실 — collect-state 에 있던 파일이 tip 에 없다(트리를 통째로 덮어썼다)")
    log.info("collect-state 에 %s 없음(최초 실행) — 처음부터", name)
    return False


def collect(repo: Path, script: str, *args: str, env: dict[str, str] | None = None) -> None:
    """수집 스크립트를 Actions 와 같은 자리(ai/)·같은 인자로 부른다. 키·상한은 파드 환경변수에서 온다(Helm values)."""
    # 토큰·git 헤더는 넘기지 않는다 — 수집기는 GitHub 을 부르지 않는다(Actions 판도 GH_TOKEN 을 이 스텝에 주지 않는다).
    plain = {k: v for k, v in os.environ.items() if k != "GH_TOKEN"}
    sh(["uv", "run", "python", f"scripts/collect/{script}", *args], repo / "ai", env=plain | (env or {}))


def require_key(name: str) -> None:
    # Actions 는 키가 없으면 "수집 생략·성공"으로 끝낸다(스케줄을 미리 켜 둬도 빨간불이 안 나게). 실 모드는 사람이 켠
    # 것이라 키가 없으면 설정 오류다 — 초록불로 넘기면 아무것도 안 모은 날이 쌓인다.
    if not os.environ.get(name):
        raise RuntimeError(f"BATCH_LIVE=1 인데 {name} 가 없다 — 파드 시크릿을 확인할 것")


def count(doc: Path) -> int:
    return len(json.loads(doc.read_text(encoding="utf-8"))["proposals"])


def merge_pois(repo: Path) -> dict:
    """그날 산출물을 공유본에 병합(제자리) — ai-poi-collect 의 sync 스텝 앞부분. 축소 가드에 쓸 숫자를 돌려준다.
    병합기의 시도 게이트(`--state`)·격리 상한은 병합기 안에 있다 — 실패하면 예외로 끝나고 게시·영속은 돌지 않는다."""
    shared = repo / "ai/data/collected_pois.json"
    before = count(shared)
    collect(repo, "merge_pois_docs.py", "--allow-mixed", "--state", "collect_state.json",
            "-o", "data/collected_pois.json", "data/collected_pois.json", "collected_pois.json")
    stats = json.loads(shared.read_text(encoding="utf-8")).get("stats") or {}
    return {"before": before, "after": count(shared), "dropped": int(stats.get("retro_dropped_existing", 0))}


def shrink_failure(numbers: dict) -> str | None:
    """합본 + 의도한 소급 제거가 공유본보다 작으면 축소 사고 — Actions 판과 같은 가드(조용한 데이터 유실 금지)."""
    if numbers["after"] + numbers["dropped"] < numbers["before"]:
        return (f"합본({numbers['after']:,}건 + 의도 제거 {numbers['dropped']:,}건)이 공유본({numbers['before']:,}건)보다 "
                "작다 — 축소 덮어쓰기 차단")
    return None


def gh(args: list[str], repo: Path, check: bool = True) -> subprocess.CompletedProcess:
    return sh(["gh", *args, "-R", os.environ.get("BATCH_GH_REPO", "ASM-TripPilot/trippilot")], repo, check=check,
              capture_output=True)


def publish_pois(repo: Path, numbers: dict, wait_s: float = 5) -> str:
    """공유본을 롤링 PR 로 develop 에 넣고 **머지됐는지 확인한다** — ai-poi-collect 의 sync 스텝 뒷부분.
    머지를 확인하지 못하면 예외 → 상태를 영속하지 않는다(TRIP-1475: 공유본에 못 들어간 행이 색인에 찍히면 영영 안 온다).
    반환: "unchanged"(변화 없음 — 잃을 것이 없어 영속해도 된다) 또는 머지된 PR 번호."""
    # 비교 기준은 워킹트리가 아니라 **지금의 develop**(받아 온 origin/develop)이다.
    # - 앞 시도가 커밋·push 뒤 머지 확인에서 실패하고 태스크를 다시 돌리면 워킹트리는 깨끗하다. 워킹트리로 보면
    #   "변화 없음"이 되어 머지 확인 없이 커서를 저장한다.
    # - 복제 때의 origin/develop 에 고정하면, 앞 시도의 PR 이 확인 뒤에 머지됐을 때 재시도가 같은 내용으로 빈 PR 을 연다.
    #   지금 develop 이 같은 내용이면 공유본이 이미 들어간 것이다 — 그때만 "변화 없음"(→ 커서 저장)이다.
    sh(["git", "fetch", "--quiet", "--depth", "1", "origin", "develop"], repo)
    if sh(["git", "diff", "--quiet", "origin/develop", "--", "ai/data/collected_pois.json"], repo,
          check=False).returncode == 0:
        log.info("공유본 변화 없음(develop 과 같다) — PR 생략")
        return "unchanged"
    sh(["git", "checkout", "-B", SYNC_BRANCH], repo)
    sh(["git", "add", "ai/data/collected_pois.json"], repo)
    if sh(["git", "diff", "--cached", "--quiet"], repo, check=False).returncode != 0:   # 재시도면 이미 커밋돼 있다
        sh(["git", "commit", "-q", "-m",
            f"chore(ai): 수집 공유본 병합 갱신 — {numbers['before']}→{numbers['after']}건 (TRIP-392)"], repo)
    sh(["git", "push", "-f", "origin", SYNC_BRANCH], repo)
    if gh(["pr", "list", "--head", SYNC_BRANCH, "--state", "open", "--json", "number", "--jq", "length"],
          repo).stdout.strip() == "0":
        gh(["pr", "create", "--base", "develop", "--head", SYNC_BRANCH, "--title", "chore(ai): 수집 공유본 자동 갱신 (TRIP-392)",
            "--body", ("Airflow `poi_collect_live` 가 병합한 공유본 자동 PR(축소 가드·시도 게이트·검증 통과 뒤). "
                       "ai-poi-collect 의 같은 PR 과 규칙이 같다 — 자동 머지되고, 머지 뒤 backend-ci 를 develop 으로 띄운다.")],
           repo, check=False)
    pr = gh(["pr", "list", "--head", SYNC_BRANCH, "--state", "open", "--json", "number", "--jq", ".[0].number // empty"],
            repo).stdout.strip()
    if not pr:
        raise RuntimeError("열린 공유본 PR 이 없다 — 상태를 영속하지 않는다")
    # --auto 는 켜기만 해도 0 이다 — 종료 코드가 아니라 PR 상태로 머지를 확인한다(Actions 판 주석 참조).
    if gh(["pr", "merge", pr, "--squash", "--auto"], repo, check=False).returncode != 0:
        gh(["pr", "merge", pr, "--squash"], repo, check=False)
    state = ""
    for _ in range(6):
        state = gh(["pr", "view", pr, "--json", "state", "--jq", ".state"], repo, check=False).stdout.strip()
        if state == "MERGED":
            break
        time.sleep(wait_s)
    if state != "MERGED":
        raise RuntimeError(f"공유본 PR #{pr} 이 머지되지 않았다(상태 {state or '?'}) — 상태를 영속하지 않는다")
    # 봇 머지 push 로는 backend-ci 런이 안 생긴다 — 공유본을 읽는 실문서 계약 IT 를 직접 띄운다.
    if gh(["workflow", "run", "backend-ci.yml", "--ref", "develop"], repo, check=False).returncode != 0:
        log.warning("backend-ci 디스패치 실패 — Actions 에서 backend-ci 를 develop 으로 수동 실행할 것")
    return pr


def persist(repo: Path, name: str, message: str) -> str:
    """`ai/<name>` 을 collect-state 브랜치에 커밋·푸시하고 왕복을 확인한다. 브랜치를 ai-llm-smoke 등과 **공유**하므로
    기존 트리에서 자기 파일만 바꾼다(`ls-tree --full-tree` — 빠지면 서로를 덮는다). 워킹트리는 건드리지 않는다(plumbing)."""
    source = repo / "ai" / name
    if not source.is_file():
        raise FileNotFoundError(f"영속할 {name} 이 없다: {source}")
    parent, base = [], ""
    found = sh(["git", "ls-remote", "--exit-code", "--heads", "origin", STATE_BRANCH], repo, check=False,
               capture_output=True)
    if found.returncode not in (0, 2):
        raise RuntimeError(f"collect-state 조회 실패(종료 {found.returncode}) — 부모 없이 덮지 않는다")
    if found.returncode == 0:
        sh(["git", "fetch", "--quiet", "origin", STATE_BRANCH], repo)
        parent = ["-p", "FETCH_HEAD"]
        base = "".join(f"{line}\n" for line in out(["git", "ls-tree", "--full-tree", "FETCH_HEAD"], repo).splitlines()
                       if not line.endswith(f"\t{name}"))
    blob = out(["git", "hash-object", "-w", str(source)], repo)
    tree = out(["git", "mktree"], repo, input=f"{base}100644 blob {blob}\t{name}\n")
    commit = out(["git", "commit-tree", tree, *parent, "-m", message], repo)
    sh(["git", "push", "origin", f"{commit}:refs/heads/{STATE_BRANCH}"], repo)
    sh(["git", "fetch", "--quiet", "origin", STATE_BRANCH], repo)
    if sh(["git", "cat-file", "-e", f"FETCH_HEAD:{name}"], repo, check=False).returncode != 0:
        raise RuntimeError(f"상태 왕복 실패 — push 직후인데 collect-state tip 에 {name} 이 없다")
    return commit
