"""Strict boundaries and secret-safe process execution for manual AWS teardown."""
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess


def matched(pattern, value, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError(f'{label} 입력 형식이 올바르지 않습니다')
    return value


@dataclass(frozen=True)
class Settings:
    environment: str
    account: str
    region: str
    role: str
    sha: str
    run_id: str
    attempt: str
    bootstrap_role: str = ''

    def __post_init__(self):
        matched(r'dev|prd', self.environment, '환경')
        matched(r'[0-9]{12}', self.account, 'AWS 계정')
        matched(r'[a-z]{2}(?:-[a-z]+)+-[0-9]+', self.region, 'AWS 리전')
        matched(r'[0-9a-f]{40}', self.sha, 'Git SHA')
        matched(r'[0-9]+', self.run_id, '실행 ID')
        matched(r'[1-9][0-9]*', self.attempt, '재시도 번호')
        if self.role != f'arn:aws:iam::{self.account}:role/{self.cluster}-github-deploy':
            raise ValueError('배포 역할이 선택한 환경·계정과 다릅니다')

    @property
    def cluster(self):
        return f'trippilot-{self.environment}'

    @property
    def state_bucket(self):
        return f'trippilot-tfstate-{self.account}-{self.region}-{self.environment}'

    @property
    def state_key(self):
        return 'terraform.tfstate'


@dataclass(frozen=True)
class Options:
    scope: str
    operation: str
    snapshot_policy: str
    purge_state: bool


def configuration(values):
    settings = Settings(
        values.get('DEPLOY_ENVIRONMENT', ''), values.get('AWS_ACCOUNT_ID', ''),
        values.get('AWS_REGION', ''), values.get('AWS_ROLE_ARN', ''),
        values.get('AWS_COMMIT_SHA', ''), values.get('GITHUB_RUN_ID', ''),
        values.get('GITHUB_RUN_ATTEMPT', ''), values.get('AWS_BOOTSTRAP_ROLE_ARN', ''),
    )
    scope = matched(r'service|bootstrap', values.get('TEARDOWN_SCOPE', ''), '삭제 범위')
    operation = matched(r'plan|destroy', values.get('TEARDOWN_OPERATION', ''), '작업')
    snapshot = matched(r'retain|skip', values.get('SNAPSHOT_POLICY', ''), '스냅샷 정책')
    purge = matched(r'true|false', values.get('PURGE_STATE', ''), 'state 삭제') == 'true'
    if (scope == 'service' and purge) or (scope == 'bootstrap' and snapshot != 'retain'):
        raise ValueError('선택한 범위와 스냅샷·state 삭제 옵션이 맞지 않습니다')
    if operation == 'destroy' and values.get('DELETE_CONFIRMATION') != f'DELETE {settings.environment} {settings.account}':
        raise ValueError('삭제 확인 문자열이 정확하지 않습니다')
    branch = values.get('DEPLOY_BRANCH') or ('main' if settings.environment == 'prd' else 'develop')
    if values.get('GITHUB_REF') != f'refs/heads/{branch}':
        raise ValueError('삭제 workflow는 환경별 배포 브랜치에서 실행해야 합니다')
    if values.get('GITHUB_REPOSITORY') != 'ASM-TripPilot/trippilot' or values.get('GITHUB_EVENT_NAME') != 'workflow_dispatch':
        raise ValueError('TripPilot 저장소의 수동 workflow만 실행할 수 있습니다')
    if scope == 'bootstrap':
        validate_bootstrap_role(settings)
    return settings, Options(scope, operation, snapshot, purge)


def validate_bootstrap_role(settings):
    matched(rf'arn:aws:iam::{settings.account}:role/[A-Za-z0-9_+=,.@/-]+', settings.bootstrap_role, 'bootstrap 역할')
    owned_names = {f'{settings.cluster}-{suffix}' for suffix in ('github-deploy', 'cluster', 'node')}
    if settings.bootstrap_role.rsplit('/', 1)[-1] in owned_names:
        raise ValueError('bootstrap 삭제 역할은 삭제할 스택 밖에 있어야 합니다')


def verify_source(run, root, settings):
    head = run(['git', 'rev-parse', 'HEAD'], cwd=root, quiet=True).strip()
    if head != settings.sha:
        raise ValueError('checkout SHA가 preflight에서 검증한 SHA와 다릅니다')
    dirty = run(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=root, quiet=True)
    if dirty.strip():
        raise ValueError('수정된 작업 트리에서 AWS 삭제를 실행하지 않습니다')


def verify_caller(run, settings, scope):
    result = json.loads(run(['aws', 'sts', 'get-caller-identity', '--region', settings.region, '--output', 'json'], quiet=True))
    role = settings.role if scope == 'service' else settings.bootstrap_role
    role_name = role.rsplit('/', 1)[-1]
    expected = rf'arn:aws:sts::{settings.account}:assumed-role/{re.escape(role_name)}/[A-Za-z0-9_+=,.@-]+'
    if not isinstance(result, dict) or result.get('Account') != settings.account or not re.fullmatch(expected, result.get('Arn', '')):
        raise ValueError('현재 AWS 인증 계정·역할이 삭제 대상과 다릅니다')


class Runner:
    def __init__(self, root):
        self.root = root

    def __call__(self, argv, *, stdin=None, quiet=False, cwd=None, env=None):
        inherited = {**os.environ, **(env or {})}
        if any(key.startswith('AWS_ENDPOINT_URL') and value for key, value in inherited.items()):
            raise ValueError('AWS endpoint override를 사용한 삭제는 허용하지 않습니다')
        inherited = {**inherited, 'AWS_PAGER': '', 'AWS_CLI_AUTO_PROMPT': 'off', 'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_IGNORE_CONFIGURED_ENDPOINT_URLS': 'true', 'TF_IN_AUTOMATION': 'true', 'TF_INPUT': 'false'}
        if any(key.startswith('TF_CLI_ARGS') and value for key, value in inherited.items()):
            raise ValueError('외부 Terraform CLI 옵션을 사용한 삭제는 허용하지 않습니다')
        process = subprocess.run(argv, input=stdin, text=True, capture_output=True, check=False, cwd=cwd or self.root, env=inherited)
        if process.returncode:
            raise RuntimeError(f'{Path(argv[0]).name} 명령 실패 (exit {process.returncode}); AWS 서비스 이벤트를 확인하세요. 비밀값 보호를 위해 응답 원문은 출력하지 않습니다')
        if not quiet and process.stdout:
            print(process.stdout, end='')
        return process.stdout
