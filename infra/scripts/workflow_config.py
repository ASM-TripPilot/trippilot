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
    if deploy:
        prefix = re.escape(f'arn:aws:acm:{region}:{account}:certificate/')
        require(prefix + r'[a-f0-9-]{36}', values.get('ACM_CERTIFICATE_ARN', ''), 'ACM_CERTIFICATE_ARN')
        require(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', values.get('API_HOSTNAME', ''), 'API_HOSTNAME')
    return {
        'environment': environment,
        'mode': mode,
        'state_bucket': f'trippilot-tfstate-{account}-{region}-{environment}',
        'deploy_application': deploy,
        'embedding_enabled': embedding,
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


if __name__ == '__main__':
    main()
