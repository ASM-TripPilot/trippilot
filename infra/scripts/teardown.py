"""서비스 형상을 두 개의 검증된 저장 계획으로 순서대로 삭제한다."""

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from teardown_config import Runner, configuration, verify_caller, verify_source

from teardown_gateway import aws_query, matching_nlbs, remove_gateway
from teardown_identity import validate_owned_state
from teardown_plan import (
    preparation_targets,
    print_summary,
    resource_values,
    saved_plan,
    validate_destroy,
    validate_destroy_state,
    validate_preparation,
    write_override,
)


def validate_resource_identity(resources, settings):
    validate_owned_state(resources, settings)
    database = resources.get("aws_db_instance.postgres")
    if database and (
        database.get("identifier") != settings.cluster
        or database.get("arn")
        != f"arn:aws:rds:{settings.region}:{settings.account}:db:{settings.cluster}"
    ):
        raise ValueError("Terraform state의 DB가 선택한 계정·리전·환경과 다릅니다")
    names = {
        "backend": "backend",
        "ai": "ai",
        "embedding": "embedding",
    }
    for key, name in names.items():
        repository = resources.get(f'aws_ecr_repository.app["{key}"]')
        if repository and (
            repository.get("name") != f"{settings.cluster}/{name}"
            or repository.get("registry_id") != settings.account
        ):
            raise ValueError("Terraform state의 ECR가 선택한 계정·환경과 다릅니다")


def check_snapshot(run, settings, resources, expected):
    if "aws_db_instance.postgres" not in resources:
        return
    database = expected["aws_db_instance.postgres"]
    if database["skip_final_snapshot"]:
        print("최종 DB 스냅샷: 생성하지 않고 DB 데이터를 폐기합니다")
        return
    identifier = database["final_snapshot_identifier"]
    snapshots = aws_query(
        run, "rds", "describe-db-snapshots", "--snapshot-type", "manual"
    )["DBSnapshots"]
    if not isinstance(snapshots, list):
        raise TypeError("RDS 스냅샷 목록 형식이 올바르지 않습니다")
    if any(item.get("DBSnapshotIdentifier") == identifier for item in snapshots):
        raise ValueError(
            "같은 이름의 최종 DB 스냅샷이 있습니다. 새 workflow attempt로 재실행하세요"
        )
    print(f"보존할 최종 DB 스냅샷: {identifier}")


def validate_final_policy(plan, expected):
    for item in plan.get("resource_changes", []):
        address, change = item["address"], item["change"]
        if address not in expected or change["actions"] != ["delete"]:
            continue
        before = change.get("before")
        if not isinstance(before, dict) or any(
            before.get(key) != value for key, value in expected[address].items()
        ):
            raise ValueError(
                "최종 삭제 계획의 보호·스냅샷·ECR 정책이 준비 계획과 다릅니다"
            )


def apply_saved(run, directory, plan):
    run(
        [
            "terraform",
            "apply",
            "-input=false",
            "-no-color",
            "-lock-timeout=60s",
            str(plan),
        ],
        cwd=directory,
        quiet=True,
    )


def assert_empty_state(run, directory):
    remaining = run(["terraform", "state", "list"], cwd=directory, quiet=True)
    if remaining.strip():
        raise RuntimeError(
            "Terraform state에 리소스가 남았습니다. bootstrap을 삭제하지 마세요"
        )


def prepare_plan(run, directory, variables, temp, resources, expected):
    targets = preparation_targets(resources)
    if not targets:
        return None
    path = temp / "teardown-prepare.tfplan"
    plan = saved_plan(run, directory, variables, path, targets=targets)
    validate_preparation(plan, {address: expected[address] for address in targets})
    print_summary(plan, "삭제 보호·스냅샷·이미지 정리 준비")
    return path


def finish_destroy(run, settings, directory, variables, temp, resources, expected):
    final_path = temp / "teardown-destroy.tfplan"
    final = saved_plan(run, directory, variables, final_path, destroy=True)
    validate_destroy(final)
    remaining = resource_values(final)
    validate_destroy_state(final, remaining)
    validate_resource_identity(remaining, settings)
    if remaining.keys() - resources.keys():
        raise ValueError("최종 삭제 계획에 사전 검토하지 않은 리소스가 추가되었습니다")
    validate_final_policy(final, expected)
    if matching_nlbs(run, settings, resources):
        raise RuntimeError("최종 삭제 직전에 NLB가 다시 발견되어 중단합니다")
    apply_saved(run, directory, final_path)
    assert_empty_state(run, directory)
    print(
        "서비스 삭제 완료: Terraform state가 비었습니다. bootstrap은 별도로 삭제하세요"
    )


def destroy_service(
    run, settings, directory, config, temp, *, execute=False, snapshot_policy="retain"
):
    expected = write_override(directory, settings, snapshot_policy)
    variables = temp / "teardown.tfvars.json"
    variables.write_text(json.dumps(config))
    variables.chmod(0o600)
    run(["terraform", "validate", "-no-color"], cwd=directory, quiet=True)
    preview = saved_plan(
        run, directory, variables, temp / "teardown-preview.tfplan", destroy=True
    )
    validate_destroy(preview)
    resources = resource_values(preview)
    validate_destroy_state(preview, resources)
    validate_resource_identity(resources, settings)
    print_summary(preview, "서비스 삭제 계획")
    if not resources:
        print("삭제할 서비스 리소스가 없습니다")
        if execute:
            apply_saved(run, directory, temp / "teardown-preview.tfplan")
            assert_empty_state(run, directory)
        return
    check_snapshot(run, settings, resources, expected)
    print("ECR 저장소와 이미지는 삭제하며 자동 DB 백업은 삭제합니다")
    preparation = prepare_plan(run, directory, variables, temp, resources, expected)
    if not execute:
        print("조회·계획만 완료했습니다. 서비스와 보호 설정은 변경하지 않았습니다")
        return
    remove_gateway(run, settings, resources)
    if preparation:
        apply_saved(run, directory, preparation)
    finish_destroy(run, settings, directory, variables, temp, resources, expected)


def initialize_terraform(run, root, settings, temp):
    directory = temp / 'terraform'
    source = root / 'infra/terraform/stack'
    directory.mkdir(mode=0o700)
    for path in source.iterdir():
        if path.name.endswith(('.tf', '.tf.json')) or path.name == '.terraform.lock.hcl':
            shutil.copyfile(path, directory / path.name)
    run([
        'terraform', 'init', '-input=false', '-no-color', '-lockfile=readonly',
        f'-backend-config=bucket={settings.state_bucket}',
        f'-backend-config=key={settings.state_key}',
        f'-backend-config=region={settings.region}',
        '-backend-config=encrypt=true', '-backend-config=use_lockfile=true',
    ], cwd=directory, quiet=True)
    # Keep the checked-in environment configuration, including customized settings.
    shutil.copyfile(root / f'infra/terraform/environments/{settings.environment}.tfvars', directory / 'environment.auto.tfvars')
    config = {
        'environment': settings.environment, 'aws_account_id': settings.account,
        'aws_region': settings.region, 'deployment_role_arn': settings.role,
    }
    return directory, config


def arguments(argv=None):
    parser = argparse.ArgumentParser(description='Plan or explicitly execute TripPilot AWS teardown')
    for option in ('environment', 'scope', 'operation', 'snapshot-policy', 'purge-state', 'confirmation'):
        parser.add_argument(f'--{option}')
    parser.add_argument('--validate-only', action='store_true')
    return parser.parse_args(argv)


def run_main(argv=None, *, root=None, run=None):
    args = arguments(argv)
    keys = {'environment': 'DEPLOY_ENVIRONMENT', 'scope': 'TEARDOWN_SCOPE', 'operation': 'TEARDOWN_OPERATION', 'snapshot_policy': 'SNAPSHOT_POLICY', 'purge_state': 'PURGE_STATE', 'confirmation': 'DELETE_CONFIRMATION'}
    values = {**os.environ, **{key: getattr(args, option) for option, key in keys.items() if getattr(args, option) is not None}}
    settings, options = configuration(values)
    root = root or Path(__file__).resolve().parents[2]
    run = run or Runner(root)
    verify_source(run, root, settings)
    if args.validate_only:
        print(f'삭제 입력·소스 검증 완료: {settings.environment}, {options.scope}, {options.operation}')
        return
    verify_caller(run, settings, options.scope)
    with tempfile.TemporaryDirectory(prefix='trippilot-teardown-') as temporary:
        temp = Path(temporary)
        # Kubeconfig and provider-generated files stay within the private directory.
        scoped_run = lambda command, **kwargs: run(command, **{**kwargs, 'env': {**kwargs.get('env', {}), 'KUBECONFIG': str(temp / 'kubeconfig'), 'AWS_DEFAULT_REGION': settings.region, 'AWS_REGION': settings.region}})
        if options.scope == 'bootstrap':
            from teardown_bootstrap import delete_bootstrap
            delete_bootstrap(scoped_run, settings, temp, execute=options.operation == 'destroy', purge_state=options.purge_state)
        else:
            directory, config = initialize_terraform(scoped_run, root, settings, temp)
            destroy_service(scoped_run, settings, directory, config, temp, execute=options.operation == 'destroy', snapshot_policy=options.snapshot_policy)


def main():
    try:
        run_main()
    except (ValueError, TypeError, RuntimeError, OSError, KeyError) as error:
        # Errors are fixed validator messages; response bodies are never interpolated.
        print(f'::error::{error}', file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
