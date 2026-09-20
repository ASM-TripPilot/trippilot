"""격리된 삭제 전용 설정과 Terraform 저장 계획의 변경 범위 검증."""

import json

from teardown_config import matched

PREPARATION_ADDRESSES = (
    "aws_db_instance.postgres",
    "aws_eks_cluster.this",
    'aws_ecr_repository.app["embedding"]',
    'aws_ecr_repository.app["backend"]',
    'aws_ecr_repository.app["ai"]',
)


def write_override(directory, settings, snapshot_policy):
    matched(r"retain|skip", snapshot_policy, "최종 DB 스냅샷 정책")
    snapshot = (
        f"trippilot-{settings.environment}-final-{settings.run_id}-{settings.attempt}"
    )
    matched(r"[a-z][a-z0-9-]{0,254}", snapshot, "최종 DB 스냅샷 이름")
    database = {
        "deletion_protection": False,
        "skip_final_snapshot": snapshot_policy == "skip",
        "final_snapshot_identifier": snapshot if snapshot_policy == "retain" else None,
        "delete_automated_backups": True,
    }
    cluster = {"deletion_protection": False}
    repository = {"force_delete": True}
    override = {
        "resource": {
            "aws_db_instance": {"postgres": database},
            "aws_eks_cluster": {"this": cluster},
            "aws_ecr_repository": {"app": repository},
        }
    }
    path = directory / "teardown_override.tf.json"
    path.write_text(json.dumps(override))
    path.chmod(0o600)
    return {
        "aws_db_instance.postgres": database,
        "aws_eks_cluster.this": cluster,
        **{address: repository for address in PREPARATION_ADDRESSES[2:]},
    }


def module_resources(module):
    if not isinstance(module, dict):
        raise TypeError("Terraform state 모듈 형식이 올바르지 않습니다")
    resources = module.get("resources", [])
    children = module.get("child_modules", [])
    if not isinstance(resources, list) or not isinstance(children, list):
        raise TypeError("Terraform state 리소스 목록이 올바르지 않습니다")
    return [
        *resources,
        *(item for child in children for item in module_resources(child)),
    ]


def resource_values(plan):
    root = plan.get("prior_state", {}).get("values", {}).get("root_module", {})
    resources = module_resources(root)
    if any(
        not isinstance(item, dict)
        or item.get("mode") not in {"managed", "data"}
        or not isinstance(item.get("address"), str)
        for item in resources
    ):
        raise ValueError("Terraform state 리소스 주소·종류가 올바르지 않습니다")
    managed = [item for item in resources if item["mode"] == "managed"]
    if any(not isinstance(item.get("values"), dict) for item in managed):
        raise ValueError("Terraform managed 리소스 값이 올바르지 않습니다")
    values = {item["address"]: item["values"] for item in managed}
    if len(values) != len(managed):
        raise ValueError("Terraform state에 중복 리소스 주소가 있습니다")
    return values


def preparation_targets(resources):
    return [address for address in PREPARATION_ADDRESSES if address in resources]


def has_unknown(value):
    if isinstance(value, dict):
        return any(has_unknown(item) for item in value.values())
    if isinstance(value, list):
        return any(has_unknown(item) for item in value)
    return value is not False and value is not None


def checked_changes(plan, *, targeted=False):
    if (
        not isinstance(plan, dict)
        or not isinstance(plan.get("format_version"), str)
        or plan["format_version"].split(".")[0] != "1"
        or plan.get("errored", False) is not False
        or not isinstance(plan.get("complete", True), bool)
        or (plan.get("complete", True) is not True and not targeted)
        or plan.get("deferred_changes")
        or not isinstance(plan.get("resource_changes", []), list)
    ):
        raise ValueError("지원하지 않거나 불완전한 Terraform 계획입니다")
    for item in plan.get("resource_changes", []):
        if not isinstance(item, dict) or not isinstance(item.get("change"), dict):
            raise TypeError("Terraform 리소스 변경 형식이 올바르지 않습니다")
        if item.get("mode") not in {"managed", "data"} or not isinstance(
            item.get("address"), str
        ):
            raise ValueError("Terraform 리소스 주소·종류가 올바르지 않습니다")
    return plan.get("resource_changes", [])


def validate_preparation(plan, expected):
    # Terraform은 -target을 사용한 계획을 complete=false로 표시한다.
    # deferred_changes는 여전히 거부하고 모든 준비 대상을 개별 검증한다.
    changes = checked_changes(plan, targeted=True)
    if expected.keys() - {item["address"] for item in changes}:
        raise ValueError("삭제 준비 계획에서 필수 대상 리소스가 누락되었습니다")
    for item in changes:
        address, change = item["address"], item["change"]
        actions = change.get("actions")
        if actions not in (["no-op"], ["update"]) or has_unknown(
            change.get("after_unknown")
        ):
            raise ValueError(
                "삭제 준비 계획에 생성·교체·삭제 또는 미확정 값이 있습니다"
            )
        before, after = change.get("before"), change.get("after")
        if not isinstance(before, dict) or not isinstance(after, dict):
            raise TypeError("삭제 준비 변경 전후 값이 올바르지 않습니다")
        allowed = expected.get(address, {})
        differences = {
            key
            for key in before.keys() | after.keys()
            if before.get(key) != after.get(key)
        }
        if differences - allowed.keys() or any(
            after.get(key) != value for key, value in allowed.items()
        ):
            raise ValueError("삭제 준비 계획이 허용된 보호·스냅샷 속성을 벗어났습니다")
        if actions == ["update"] and (
            address not in expected or item["mode"] != "managed"
        ):
            raise ValueError("삭제 준비 대상 이외의 리소스 변경입니다")
        if actions == ["no-op"] and differences:
            raise ValueError("Terraform no-op 계획의 전후 값이 다릅니다")


def validate_destroy(plan):
    for item in checked_changes(plan):
        change = item["change"]
        if change.get("actions") not in (["delete"], ["no-op"]):
            raise ValueError("삭제 계획에 생성·변경·교체가 포함되어 있습니다")
        if has_unknown(change.get("after_unknown")):
            raise ValueError("삭제 계획에 미확정 값이 있습니다")
        if change["actions"] == ["delete"] and change.get("after") is not None:
            raise ValueError("삭제 계획의 이후 값이 비어 있지 않습니다")


def validate_destroy_state(plan, resources):
    addresses = {
        item["address"] for item in checked_changes(plan) if item["mode"] == "managed"
    }
    if addresses != resources.keys():
        raise ValueError(
            "삭제 계획과 refreshed state의 managed 리소스가 일치하지 않습니다"
        )


def saved_plan(run, directory, variables, destination, *, destroy=False, targets=()):
    command = [
        "terraform",
        "plan",
        "-input=false",
        "-no-color",
        "-lock-timeout=60s",
        f"-var-file={variables}",
        f"-out={destination}",
    ]
    command += ["-destroy"] if destroy else []
    command += [f"-target={target}" for target in targets]
    run(command, cwd=directory, quiet=True)
    if destination.exists():
        destination.chmod(0o600)
    return json.loads(
        run(["terraform", "show", "-json", str(destination)], cwd=directory, quiet=True)
    )


def print_summary(plan, label):
    changes = checked_changes(plan, targeted=True)
    counts = {
        action: sum(item["change"]["actions"] == [action] for item in changes)
        for action in ("delete", "update", "no-op")
    }
    print(
        f"{label}: 삭제 {counts['delete']}, 변경 {counts['update']}, 유지 {counts['no-op']}"
    )
    for item in sorted(changes, key=lambda item: item["address"]):
        print(f"  {item['change']['actions'][0]} {item['address']}")
