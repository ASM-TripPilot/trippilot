"""Verify teardown code from a trusted dispatch branch before requesting OIDC."""
from __future__ import annotations

import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Mapping


def verify(values: Mapping[str, str], root: Path) -> str:
    environment = values.get('DEPLOY_ENVIRONMENT')
    if environment not in {'dev', 'prd'}:
        raise ValueError('DEPLOY_ENVIRONMENT must be dev or prd')
    if values.get('GITHUB_REPOSITORY') != 'ASM-TripPilot/trippilot':
        raise ValueError('Teardown must run in ASM-TripPilot/trippilot')
    branch = values.get('DEPLOY_BRANCH') or ('main' if environment == 'prd' else 'develop')
    if values.get('GITHUB_REF') != f'refs/heads/{branch}':
        raise ValueError('Dispatch must use the configured environment deployment branch')
    requested = values.get('REQUESTED_SHA', '')
    trusted = values.get('GITHUB_SHA', '')
    if not all(re.fullmatch(r'[a-f0-9]{40}', sha) for sha in (requested, trusted)):
        raise ValueError('Requested and dispatch SHA must be full 40-character commit IDs')
    def git(*args: str) -> str:
        return subprocess.check_output(['git', '-C', str(root), *args], text=True, stderr=subprocess.PIPE).strip()
    try:
        if git('rev-parse', 'HEAD') != trusted:
            raise ValueError('Preflight checkout must match the trusted dispatch SHA')
        git('merge-base', '--is-ancestor', requested, trusted)
    except subprocess.CalledProcessError as error:
        raise ValueError('Requested SHA is not a commit included in the trusted dispatch branch') from error
    return requested


def main() -> None:
    try:
        sha = verify(os.environ, Path.cwd())
        with Path(os.environ['GITHUB_OUTPUT']).open('a', encoding='utf-8') as output:
            output.write(f'sha={sha}\n')
    except (ValueError, KeyError, OSError) as error:
        print(f'::error::{error}', file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == '__main__':
    main()
