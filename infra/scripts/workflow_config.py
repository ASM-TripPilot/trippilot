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


# 기능별 모델 배정 한 항목 — 이 값은 GITHUB_ENV 한 줄로 넘어가므로 줄바꿈·공백류가 끼면 뒤 스텝 env 를 위조한다.
# 그래서 구분자도 쉼표와 스페이스만 받는다. 기능 이름이 AI 에 실재하는지는 runtime_secrets 가 같은 커밋 소스로 본다.
_FEATURE_MODEL = r'[A-Za-z][A-Za-z0-9_]*=[A-Za-z0-9][A-Za-z0-9._:/@+-]*'


def settings(values: Mapping[str, str]) -> dict:
    environment = require(r'dev|prd', values.get('DEPLOY_ENVIRONMENT', ''), 'DEPLOY_ENVIRONMENT')
    mode = require(r'plan|apply', values.get('DEPLOY_MODE', ''), 'DEPLOY_MODE')
    account = require(r'\d{12}', values.get('AWS_ACCOUNT_ID', ''), 'AWS_ACCOUNT_ID')
    region = require(r'[a-z]{2}-[a-z]+-\d', values.get('AWS_REGION', ''), 'AWS_REGION')
    role = f'arn:aws:iam::{account}:role/trippilot-{environment}-github-deploy'
    if values.get('AWS_ROLE_ARN') != role:
        raise ValueError('AWS_ROLE_ARN must match the bootstrap role for this account/environment')
    # 운영은 main 에서만 나간다(2026-10-15 개발·운영 분리) — dev 스택의 prod 대상이 출시 앱이 보는 서버다.
    # develop 은 개발 대상(trippilot-dev · dev-api)으로만 간다. GitHub Environment 브랜치 규칙도 같게 둔다.
    target = require(r'prod|dev', values.get('DEPLOY_TARGET', ''), 'DEPLOY_TARGET')
    if target == 'dev' and environment != 'dev':
        raise ValueError('The dev target lives inside the dev stack only')
    if environment == 'dev' and target == 'prod':
        # 출시 앱 서버는 main 고정 — DEPLOY_BRANCH 로 풀 수 없다. Environment 규칙이 main·develop 을 둘 다 허용하므로
        # 대상 구분은 이 줄만 한다; 변수 하나로 develop 직배포(10/14 빈 일정 사고의 길)가 되살아나지 않게.
        branch = 'main'
    else:
        branch = values.get('DEPLOY_BRANCH') or ('develop' if target == 'dev' else 'main')
    if values.get('GITHUB_REF') != f'refs/heads/{branch}':
        raise ValueError(f'Deployment branch must be {branch}; configure GitHub Environment branch protection too')
    requested_deploy = boolean(values, 'DEPLOY_APPLICATION')
    deploy = mode == 'apply' and requested_deploy
    embedding = boolean(values, 'EMBEDDING_ENABLED')
    # 배포 대상(2026-10-15 개발·운영 분리). dev 는 같은 스택 안의 개발 서버다 — 공유 인프라(Terraform)를 바꾸지 않고,
    # 실제 푸시 발송은 늘 끈다. 입력을 고쳐 받지 않고 여기서 내린다: 기본값 그대로 개발 배포를 눌러도 된다.
    # 임베딩은 입력을 따른다(10-15 사용자 "모든 곳에서 진짜" — 끄면 개발 Plan-B 가 KB 없이 돌아 운영과 다르게 고른다).
    # 개발 KB 는 개발 DB 에 쌓이고 임베딩 파드는 개발 네임스페이스에 따로 뜬다(5Gi 노드 한 대 — EKS 자동 모드가 띄운다).
    push_mode = values.get('PUSH_MODE_INPUT') or 'keep'
    # 도우미 오케스트레이터 스위치·모델 배정(2026-10-18) — 로컬 자격이 만료된 날에도 배포 역할이 시크릿에 쓴다(push_mode 와 같은 이유).
    dialogue_orchestrator = require(r'keep|on|off', values.get('DIALOGUE_ORCHESTRATOR_INPUT') or 'keep',
                                    'DIALOGUE_ORCHESTRATOR_INPUT')
    llm_feature_models = (values.get('LLM_FEATURE_MODELS_INPUT') or '').strip(' ')
    if llm_feature_models:
        require(rf'{_FEATURE_MODEL}(?: *, *{_FEATURE_MODEL})*', llm_feature_models, 'LLM_FEATURE_MODELS_INPUT')
    # 운영 배포 규칙(TRIP-1659): 운영 서버는 열차(주 1회·앱 릴리스일)와 핫픽스 때만 만진다. 사람이 지키기만 하면 되던 규칙이
    # 안 지켜졌으므로 선언 없는 운영 apply 는 AWS 자격 증명을 받기 전에 여기서 거절한다. 인프라만 바꾸는 apply 도 운영 변경이다.
    # 값은 GITHUB_OUTPUT 한 줄로 나가므로 줄바꿈·제어 문자를 받지 않는다(DEPLOY_REASON 이 자유 문장이라 특히).
    deploy_kind, deploy_ref, deploy_reason = 'none', '', ''
    if target == 'prod' and mode == 'apply':
        deploy_kind = require(r'release|hotfix', values.get('DEPLOY_KIND', ''), 'DEPLOY_KIND (release or hotfix)')
        if deploy_kind == 'hotfix':
            deploy_ref = require(r'TRIP-[0-9]+', values.get('DEPLOY_REF', ''), 'DEPLOY_REF (a hotfix needs its Jira key)')
            deploy_reason = require(r'[^\x00-\x1f\x7f]{3,200}', (values.get('DEPLOY_REASON') or '').strip(),
                                    'DEPLOY_REASON (a hotfix needs a one-line reason)')
        else:
            deploy_ref = require(r'[A-Za-z0-9][A-Za-z0-9._-]{0,39}', values.get('DEPLOY_REF', ''),
                                 'DEPLOY_REF (a release needs a name such as the app version)')
    # 개발 대상은 검증이 끝나면 파드를 0 으로 내린다(TRIP-1659) — 노드 1대를 돌려준다. 워크플로 입력의 기본값은 true 다. 값 없이 API 로 직접 부른 경우만 끈 것으로 본다(모르는 채 재우지는 않는다).
    dev_sleep = target == 'dev' and deploy and require(
        r'true|false', values.get('DEV_SLEEP_AFTER') or 'false', 'DEV_SLEEP_AFTER') == 'true'
    certificate, hostname = values.get('PROD_ACM_CERTIFICATE_ARN', ''), values.get('PROD_API_HOSTNAME', '')
    if target == 'dev':
        if mode != 'apply':
            raise ValueError('The dev target never plans shared infrastructure; use apply to deploy it')
        if push_mode == 'expo':
            raise ValueError('The dev target must not send real pushes; choose keep or off')
        # keep 도 off 로 — 개발 시크릿을 운영에서 복사해 채우면 PUSH_MODE=expo 가 딸려 와 실제 사용자에게 간다.
        push_mode = 'off'
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
        'dialogue_orchestrator': dialogue_orchestrator,
        'llm_feature_models': llm_feature_models,
        'deploy_kind': deploy_kind,
        'deploy_ref': deploy_ref,
        'deploy_reason': deploy_reason,
        'dev_sleep': dev_sleep,
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
        stream.write(f"EFFECTIVE_DIALOGUE_ORCHESTRATOR={result['dialogue_orchestrator']}\n")
        stream.write(f"EFFECTIVE_LLM_FEATURE_MODELS={result['llm_feature_models']}\n")
        stream.write(f"ACM_CERTIFICATE_ARN={result['certificate_arn']}\n")
        stream.write(f"API_HOSTNAME={result['hostname']}\n")


if __name__ == '__main__':
    main()
