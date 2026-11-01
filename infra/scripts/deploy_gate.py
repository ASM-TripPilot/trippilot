"""Release gate for production deploys (TRIP-1659).

운영 배포는 열차(release)와 핫픽스(hotfix)만 나간다. 열차는 **개발 서버에서 이미 검증한 코드**여야 한다 — 승격 PR 마다
"git diff <develop sha> HEAD -- . ':!.github' 비어 있음" 을 손으로 적던 것을 여기서 기계가 확인한다.

- 대상: 최근 72시간 안에 성공한 개발 대상 배포 런(develop 브랜치 = 개발 대상, 운영은 main 고정이라 섞이지 않는다).
- 통과: 그 런의 커밋과 지금 배포하려는 커밋의 트리가 `.github` 만 빼고 같다(main 은 워크플로 사본을 따로 유지한다).
- 핫픽스는 검증이 사후라 이 게이트를 건너뛴다(선언 검사는 workflow_config 가 이미 했다).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Callable, Iterable, Mapping

WINDOW = timedelta(hours=72)
# aws-deploy.yml 의 run-name 이 "<target> <mode> app=<deploy_application> kind=<kind>" 라서 개발 앱 배포는 이 접두로 시작한다.
DEV_TITLE = 'dev apply app=true'


def candidates(runs: Iterable[Mapping], now: datetime, window: timedelta = WINDOW) -> list[str]:
    """검증 후보 커밋 — 성공한 개발 앱 배포 런의 head_sha, 최신순."""
    found = []
    for run in runs:
        if run.get('conclusion') != 'success' or run.get('head_branch') != 'develop':
            continue
        if not str(run.get('display_title', '')).startswith(DEV_TITLE):
            continue
        created = datetime.fromisoformat(str(run['created_at']).replace('Z', '+00:00'))
        if now - created <= window:
            found.append((created, str(run['head_sha'])))
    return [sha for _, sha in sorted(found, reverse=True)]


def validated_sha(runs: Iterable[Mapping], now: datetime, same_tree: Callable[[str], bool],
                  window: timedelta = WINDOW) -> str | None:
    for sha in candidates(runs, now, window):
        if same_tree(sha):
            return sha
    return None


def fetch_runs(repo: str, since: datetime) -> list[dict]:
    """윈도(72시간) 안의 성공한 develop 런만 서버에서 거른다. 개발 배포가 하루 17번 나간 날(10/22)도 있어서 "최근 N개"로
    읽으면 윈도 안의 유효한 런이 한도 밖으로 밀릴 수 있다 — 시간 조건으로 걸고 한 번에 100개(API 상한)까지 읽는다."""
    out = subprocess.run(
        ['gh', 'api', '-X', 'GET', f'repos/{repo}/actions/workflows/aws-deploy.yml/runs',
         '-f', 'branch=develop', '-f', 'status=success', '-f', 'per_page=100',
         '-f', f'created=>={since.strftime("%Y-%m-%dT%H:%M:%SZ")}'],
        check=True, capture_output=True, text=True).stdout
    return json.loads(out)['workflow_runs']


def same_tree(sha: str) -> bool:
    """checkout 은 깊이 1 이라 후보 커밋을 SHA 로 직접 받아 온다. 받지 못하거나 diff 가 에러면 검증 안 된 것으로 본다."""
    if subprocess.run(['git', 'fetch', '--depth=1', '--quiet', 'origin', sha]).returncode != 0:
        return False
    return subprocess.run(['git', 'diff', '--quiet', sha, 'HEAD', '--', '.', ':!.github']).returncode == 0


def run_gate(env: Mapping[str, str], runs_source: Callable[[str, datetime], list[dict]], tree_check: Callable[[str], bool],
             now: datetime) -> tuple[int, str]:
    """(종료 코드, 메시지). 열차(release)만 검사하고 핫픽스·그 밖에는 통과."""
    kind = env.get('DEPLOY_KIND', '')
    if kind != 'release':
        return 0, f'gate skipped (deploy_kind={kind or "none"})'
    sha = validated_sha(runs_source(env['GITHUB_REPOSITORY'], now - WINDOW), now, tree_check)
    if sha is None:
        return 1, ('A release needs the same code to have passed a dev-target deploy within '
                   f'{int(WINDOW.total_seconds() // 3600)} hours: run this workflow with target=dev (app deploy) from develop first, '
                   'or declare deploy_kind=hotfix with its Jira key.')
    return 0, f'dev-validated commit: {sha}'


def main() -> None:
    try:
        code, message = run_gate(os.environ, fetch_runs, same_tree, datetime.now(timezone.utc))
    except (subprocess.CalledProcessError, KeyError, ValueError) as error:
        print(f'::error::release gate could not verify the dev run: {error}', file=sys.stderr)
        raise SystemExit(1) from error
    print(message if code == 0 else f'::error::{message}', file=sys.stderr if code else sys.stdout)
    if code == 0 and os.environ.get('GITHUB_OUTPUT'):
        sha = message.rsplit(': ', 1)[-1] if message.startswith('dev-validated') else ''
        with Path(os.environ['GITHUB_OUTPUT']).open('a', encoding='utf-8') as stream:
            stream.write(f'dev_validated_sha={sha}\n')
    raise SystemExit(code)


if __name__ == '__main__':
    main()
