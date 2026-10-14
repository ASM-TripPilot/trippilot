"""Validate manual deployment inputs before obtaining AWS credentials."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from typing import Mapping


def require(pattern: str, value: str, name: str) -> str:
    if not re.fullmatch(pattern, value):
        raise ValueError(f'{name} is missing or invalid')
    return value


def boolean(values: Mapping[str, str], name: str) -> bool:
    return require(r'true|false', values.get(name, ''), name) == 'true'


def settings(values: Mapping[str, str]) -> dict:
    environment = require(r'dev|prd', values.get('DEPLOY_ENVIRONMENT', ''), 'DEPLOY_ENVIRONMENT')
    mode = require(r'plan|apply', values.get('DEPLOY_MODE', ''), 'DEPLOY_MODE')
    account = require(r'\d{12}', values.get('AWS_ACCOUNT_ID', ''), 'AWS_ACCOUNT_ID')
    region = require(r'[a-z]{2}-[a-z]+-\d', values.get('AWS_REGION', ''), 'AWS_REGION')
    role = f'arn:aws:iam::{account}:role/trippilot-{environment}-github-deploy'
    if values.get('AWS_ROLE_ARN') != role:
        raise ValueError('AWS_ROLE_ARN must match the bootstrap role for this account/environment')
    branch = values.get('DEPLOY_BRANCH') or ('main' if environment == 'prd' else 'develop')
    if values.get('GITHUB_REF') != f'refs/heads/{branch}':
        raise ValueError(f'Deployment branch must be {branch}; configure GitHub Environment branch protection too')
    requested_deploy = boolean(values, 'DEPLOY_APPLICATION')
    deploy = mode == 'apply' and requested_deploy
    embedding = boolean(values, 'EMBEDDING_ENABLED')
    # 배포 대상(2026-10-15 개발·운영 분리). dev 는 같은 스택 안의 개발 서버다 — 공유 인프라(Terraform)를 바꾸지 않고,
    # 임베딩(큰 노드)과 실제 푸시 발송은 늘 끈다. 입력을 고쳐 받지 않고 여기서 내린다: 기본값 그대로 개발 배포를 눌러도 된다.
    target = require(r'prod|dev', values.get('DEPLOY_TARGET', ''), 'DEPLOY_TARGET')
    push_mode = values.get('PUSH_MODE_INPUT') or 'keep'
    certificate, hostname = values.get('PROD_ACM_CERTIFICATE_ARN', ''), values.get('PROD_API_HOSTNAME', '')
    if target == 'dev':
        if environment != 'dev':
            raise ValueError('The dev target lives inside the dev stack only')
        if mode != 'apply':
            raise ValueError('The dev target never plans shared infrastructure; use apply to deploy it')
        if push_mode == 'expo':
            raise ValueError('The dev target must not send real pushes; choose keep or off')
        # keep 도 off 로 — 개발 시크릿을 운영에서 복사해 채우면 PUSH_MODE=expo 가 딸려 와 실제 사용자에게 간다.
        push_mode = 'off'
        embedding = False
        certificate, hostname = values.get('DEV_TARGET_ACM_CERTIFICATE_ARN', ''), values.get('DEV_TARGET_API_HOSTNAME', '')
        # 개발 변수가 비었거나 운영 값과 같으면 개발 NLB 가 운영 인증서·주소를 단다 — 형식 검사로는 못 막는다.
        if deploy and (certificate == values.get('PROD_ACM_CERTIFICATE_ARN') or hostname == values.get('PROD_API_HOSTNAME')):
            raise ValueError('The dev target needs its own DEV_TARGET_ACM_CERTIFICATE_ARN and DEV_TARGET_API_HOSTNAME')
    if deploy:
        prefix = re.escape(f'arn:aws:acm:{region}:{account}:certificate/')
        require(prefix + r'[a-f0-9-]{36}', certificate, 'ACM_CERTIFICATE_ARN')
        require(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', hostname, 'API_HOSTNAME')
    return {
        'environment': environment,
        'mode': mode,
        'state_bucket': f'trippilot-tfstate-{account}-{region}-{environment}',
        'deploy_application': deploy,
        'embedding_enabled': embedding,
        'target': target,
        'terraform': target == 'prod',
        'namespace': 'trippilot-dev' if target == 'dev' else 'trippilot',
        'values_file': 'values-dev-target.yaml' if target == 'dev' else f'values-{environment}.yaml',
        'push_mode': push_mode,
        'certificate_arn': certificate,
        'hostname': hostname,
    }


def main() -> None:
    try:
        result = settings(os.environ)
    except ValueError as error:
        print(f'::error::{error}', file=sys.stderr)
        raise SystemExit(1) from error
    output = Path(os.environ['GITHUB_OUTPUT'])
    with output.open('a', encoding='utf-8') as stream:
        for name, value in result.items():
            stream.write(f'{name}={json.dumps(value) if isinstance(value, bool) else value}\n')
    # 뒤 스텝의 셸이 읽는 값 — 대상이 정한 것만 내보낸다(입력을 다시 해석하지 않게).
    with Path(os.environ['GITHUB_ENV']).open('a', encoding='utf-8') as stream:
        stream.write(f"NAMESPACE={result['namespace']}\n")
        stream.write(f"VALUES_FILE={result['values_file']}\n")
        stream.write(f"EFFECTIVE_EMBEDDING={json.dumps(result['embedding_enabled'])}\n")
        stream.write(f"EFFECTIVE_PUSH_MODE={result['push_mode']}\n")
        stream.write(f"ACM_CERTIFICATE_ARN={result['certificate_arn']}\n")
        stream.write(f"API_HOSTNAME={result['hostname']}\n")


if __name__ == '__main__':
    main()
