"""서비스 삭제를 검증한 뒤 환경별 CloudFormation bootstrap만 제거한다."""

import json
import os
import re

from teardown_state import (
    aws_json,
    bucket_arguments,
    current_state_version,
    entries,
    object_versions,
    purge_bucket,
    state_evidence,
)


def expected_resources(settings, bucket):
    return {
        "TerraformStateBucket": ("AWS::S3::Bucket", bucket),
        "TerraformStateBucketPolicy": ("AWS::S3::BucketPolicy", bucket),
        "ClusterRole": (
            "AWS::IAM::Role",
            f"trippilot-{settings.environment}-cluster",
        ),
        "NodeRole": ("AWS::IAM::Role", f"trippilot-{settings.environment}-node"),
        "DeploymentRole": (
            "AWS::IAM::Role",
            f"trippilot-{settings.environment}-github-deploy",
        ),
    }


def stack_arn(settings, name, value):
    pattern = rf"arn:aws:cloudformation:{re.escape(settings.region)}:{settings.account}:stack/{re.escape(name)}/[A-Za-z0-9-]+"
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("bootstrap stack ARN의 계정·리전·환경이 다릅니다")
    return value


def keyed(items, key, value):
    if any(
        not isinstance(item.get(key), str) or not isinstance(item.get(value), str)
        for item in items
    ):
        raise ValueError("bootstrap 메타데이터 형식이 올바르지 않습니다")
    result = {item[key]: item[value] for item in items}
    if len(result) != len(items):
        raise ValueError("bootstrap 메타데이터 키가 중복됩니다")
    return result


def required_entries(result, key):
    if key not in result:
        raise ValueError("AWS 서비스 목록이 응답에 없습니다")
    return entries(result, key)


def validate_stack_metadata(settings, stack, name, bucket, key, identifier):
    if stack.get("StackName") != name or stack.get("StackId") != identifier:
        raise ValueError("bootstrap stack 식별자가 선택한 환경과 다릅니다")
    if stack.get("StackStatus") not in {
        "CREATE_COMPLETE",
        "UPDATE_COMPLETE",
        "UPDATE_ROLLBACK_COMPLETE",
        "DELETE_FAILED",
    }:
        raise ValueError("bootstrap stack 작업 중이거나 삭제 가능한 상태가 아닙니다")
    parameters = keyed(entries(stack, "Parameters"), "ParameterKey", "ParameterValue")
    provider = f"arn:aws:iam::{settings.account}:oidc-provider/token.actions.githubusercontent.com"
    repository = parameters.get("GitHubRepository", "")
    if (
        parameters.get("Environment") != settings.environment
        or parameters.get("GitHubOidcProviderArn") != provider
    ):
        raise ValueError("bootstrap 환경·OIDC 파라미터가 올바르지 않습니다")
    if repository != "ASM-TripPilot/trippilot" or repository != os.environ.get(
        "GITHUB_REPOSITORY", "ASM-TripPilot/trippilot"
    ):
        raise ValueError("bootstrap GitHub 저장소가 실행 저장소와 다릅니다")
    outputs = keyed(entries(stack, "Outputs"), "OutputKey", "OutputValue")
    expected = {"TerraformStateBucket": bucket, "TerraformStateKey": key}
    roles = {
        "DeploymentRoleArn": "github-deploy",
    }
    expected = {
        **expected,
        **{
            output: f"arn:aws:iam::{settings.account}:role/trippilot-{settings.environment}-{suffix}"
            for output, suffix in roles.items()
        },
    }
    if any(outputs.get(output) != value for output, value in expected.items()):
        raise ValueError("bootstrap 출력의 버킷·역할이 선택한 환경과 다릅니다")


def find_stack(run, settings, name, bucket, key):
    result = aws_json(run, settings, "cloudformation", "list-stacks")
    stacks = [
        item
        for item in required_entries(result, "StackSummaries")
        if item.get("StackName") == name
        and item.get("StackStatus") != "DELETE_COMPLETE"
    ]
    if not stacks:
        return None
    if len(stacks) != 1:
        raise ValueError("bootstrap stack을 하나로 식별할 수 없습니다")
    identifier = stack_arn(settings, name, stacks[0].get("StackId"))
    result = aws_json(
        run, settings, "cloudformation", "describe-stacks", "--stack-name", identifier
    )
    descriptions = required_entries(result, "Stacks")
    if len(descriptions) != 1:
        raise ValueError("bootstrap stack 조회 결과가 올바르지 않습니다")
    validate_stack_metadata(settings, descriptions[0], name, bucket, key, identifier)
    validate_stack_resources(run, settings, bucket, identifier)
    return identifier


def validate_stack_resources(run, settings, bucket, identifier):
    result = aws_json(
        run,
        settings,
        "cloudformation",
        "list-stack-resources",
        "--stack-name",
        identifier,
    )
    resources = required_entries(result, "StackResourceSummaries")
    expected = expected_resources(settings, bucket)
    actual = {
        item.get("LogicalResourceId"): (
            item.get("ResourceType"),
            item.get("PhysicalResourceId"),
        )
        for item in resources
    }
    if actual != expected or len(actual) != len(resources):
        raise ValueError("bootstrap stack에 허용되지 않은 리소스·역할이 있습니다")
    result = aws_json(
        run,
        settings,
        "cloudformation",
        "get-template",
        "--stack-name",
        identifier,
        "--template-stage",
        "Original",
    )
    template = result.get("TemplateBody")
    if isinstance(template, str):
        try:
            template = json.loads(template)
        except ValueError:
            raise ValueError("bootstrap stack 템플릿 JSON을 확인할 수 없습니다") from None
    if not isinstance(template, dict) or not isinstance(
        template.get("Resources"), dict
    ):
        raise TypeError("bootstrap stack 템플릿을 검증할 수 없습니다")
    for name in ("TerraformStateBucket", "TerraformStateBucketPolicy"):
        resource = template["Resources"].get(name, {})
        if not isinstance(resource, dict) or resource.get("DeletionPolicy") != "Retain":
            raise ValueError("state 버킷·TLS 정책 보존 설정이 없습니다. bootstrap을 갱신하세요")


def find_bucket(run, settings, name, bucket, identifier):
    result = aws_json(run, settings, "s3api", "list-buckets")
    present = any(
        item.get("Name") == bucket for item in required_entries(result, "Buckets")
    )
    if not present:
        if identifier:
            raise ValueError(
                "bootstrap stack의 state 버킷이 없습니다. drift를 복구하세요"
            )
        return False
    arguments = bucket_arguments(settings, bucket)
    location = aws_json(run, settings, "s3api", "get-bucket-location", *arguments)
    if (location.get("LocationConstraint") or "us-east-1") != settings.region:
        raise ValueError("state 버킷의 리전이 선택한 환경과 다릅니다")
    versioning = aws_json(run, settings, "s3api", "get-bucket-versioning", *arguments)
    if versioning.get("Status") != "Enabled":
        raise ValueError("state 버킷의 버전 관리가 꺼져 있습니다. drift를 복구하세요")
    result = aws_json(run, settings, "s3api", "get-bucket-tagging", *arguments)
    tags = keyed(entries(result, "TagSet"), "Key", "Value")
    expected = {
        "Project": "trippilot",
        "Environment": settings.environment,
        "ManagedBy": "cloudformation",
    }
    if any(tags.get(key) != value for key, value in expected.items()):
        raise ValueError("state 버킷 소유 태그가 선택한 환경과 다릅니다")
    owner = stack_arn(settings, name, tags.get("aws:cloudformation:stack-id"))
    if identifier and owner != identifier:
        raise ValueError("state 버킷이 다른 bootstrap stack에 속합니다")
    return True


def service_inventory(run, settings):
    result = aws_json(run, settings, "eks", "list-clusters")
    clusters = result.get("clusters")
    if not isinstance(clusters, list) or any(
        not isinstance(name, str) for name in clusters
    ):
        raise ValueError("EKS 서비스 목록 형식이 올바르지 않습니다")
    databases = required_entries(
        aws_json(run, settings, "rds", "describe-db-instances"), "DBInstances"
    )
    vpcs = required_entries(
        aws_json(
            run,
            settings,
            "ec2",
            "describe-vpcs",
            "--filters",
            "Name=tag:Project,Values=trippilot",
            f"Name=tag:Environment,Values={settings.environment}",
        ),
        "Vpcs",
    )
    repositories = required_entries(
        aws_json(run, settings, "ecr", "describe-repositories"), "repositories"
    )
    secrets = required_entries(
        aws_json(
            run,
            settings,
            "secretsmanager",
            "list-secrets",
            "--include-planned-deletion",
        ),
        "SecretList",
    )
    for items, field in (
        (databases, "DBInstanceIdentifier"),
        (repositories, "repositoryName"),
        (secrets, "Name"),
    ):
        if any(not isinstance(item.get(field), str) for item in items):
            raise ValueError("서비스 식별자 형식이 올바르지 않습니다")
    return clusters, databases, vpcs, repositories, secrets


def ensure_services_absent(run, settings):
    cluster = f"trippilot-{settings.environment}"
    clusters, databases, vpcs, repositories, secrets = service_inventory(run, settings)
    present = (
        cluster in clusters
        or any(item["DBInstanceIdentifier"] == cluster for item in databases)
        or bool(vpcs)
        or any(
            item["repositoryName"].startswith(cluster + "/") for item in repositories
        )
        or any(
            item["Name"].startswith(f"trippilot/{settings.environment}/")
            and not item.get("DeletedDate")
            for item in secrets
        )
    )
    if present:
        raise ValueError(
            "실제 AWS 서비스가 남아 있습니다. 서비스 삭제·state drift를 먼저 확인하세요"
        )
    ensure_cache_absent(run, settings, cluster)
    ensure_load_balancers_absent(run, settings, cluster)
    groups = required_entries(
        aws_json(run, settings, "logs", "describe-log-groups", "--log-group-name-prefix",
                 f"/aws/eks/{cluster}/"), "logGroups"
    )
    if groups:
        raise ValueError("EKS 로그 서비스가 남아 있어 bootstrap 삭제를 중단합니다")


def ensure_cache_absent(run, settings, cluster):
    for operation, field, identifier in (
        ("describe-replication-groups", "ReplicationGroups", "ReplicationGroupId"),
        ("describe-cache-clusters", "CacheClusters", "CacheClusterId"),
    ):
        items = required_entries(aws_json(run, settings, "elasticache", operation), field)
        for item in items:
            name = item.get(identifier)
            if not isinstance(name, str) or not name:
                raise ValueError("Redis 서비스 목록을 확인할 수 없습니다")
            if name == cluster or name.startswith(cluster + "-"):
                raise ValueError("Redis 서비스가 남아 있어 bootstrap 삭제를 중단합니다")


def ensure_load_balancers_absent(run, settings, cluster):
    balancers = required_entries(
        aws_json(run, settings, "elbv2", "describe-load-balancers"), "LoadBalancers"
    )
    prefix = f"arn:aws:elasticloadbalancing:{settings.region}:{settings.account}:loadbalancer/"
    identifiers = [item.get("LoadBalancerArn") for item in balancers]
    if any(not isinstance(arn, str) or not arn.startswith(prefix) for arn in identifiers):
        raise ValueError("로드 밸런서 식별자가 계정·리전과 다릅니다")
    for offset in range(0, len(identifiers), 20):
        batch = identifiers[offset:offset + 20]
        descriptions = required_entries(
            aws_json(run, settings, "elbv2", "describe-tags", "--resource-arns", *batch),
            "TagDescriptions",
        )
        returned = [item.get("ResourceArn") for item in descriptions]
        if len(returned) != len(batch) or set(returned) != set(batch):
            raise ValueError("로드 밸런서 태그 조회가 완전하지 않습니다")
        for item in descriptions:
            tags = keyed(required_entries(item, "Tags"), "Key", "Value")
            if (
                tags.get("eks:eks-cluster-name") == cluster
                or f"kubernetes.io/cluster/{cluster}" in tags
                or (tags.get("Project") == "trippilot" and tags.get("Environment") == settings.environment)
            ):
                raise ValueError("로드 밸런서 서비스가 남아 있어 bootstrap 삭제를 중단합니다")


def delete_stack(run, settings, identifier):
    arguments = ["--stack-name", identifier, "--region", settings.region]
    run(
        ["aws", "cloudformation", "update-termination-protection",
         "--no-enable-termination-protection", *arguments],
        quiet=True,
    )
    run(["aws", "cloudformation", "delete-stack", *arguments], quiet=True)
    run(
        ["aws", "cloudformation", "wait", "stack-delete-complete", *arguments],
        quiet=True,
    )


def delete_bootstrap(run, settings, temp, *, execute=False, purge_state=False):
    if type(execute) is not bool or type(purge_state) is not bool:
        raise TypeError("bootstrap 삭제 옵션은 boolean이어야 합니다")
    name = f"trippilot-{settings.environment}-bootstrap"
    bucket = (
        f"trippilot-tfstate-{settings.account}-{settings.region}-{settings.environment}"
    )
    key = "terraform.tfstate"
    identifier = find_stack(run, settings, name, bucket, key)
    present = find_bucket(run, settings, name, bucket, identifier)
    ensure_services_absent(run, settings)
    version = state_evidence(run, settings, bucket, key, temp) if present else None
    print(
        f"bootstrap 삭제 대상: {settings.environment} / {settings.account} / {settings.region}"
    )
    print(
        f"CloudFormation stack: {name}; state S3: {'영구 삭제' if purge_state else '보존'}"
    )
    if not execute:
        print("조회 계획 완료: 변경하지 않았습니다")
        return
    if present:
        current_state_version(object_versions(run, settings, bucket), key, version)
    if identifier:
        delete_stack(run, settings, identifier)
    if present and purge_state:
        purge_bucket(run, settings, bucket, key, version)
    elif present:
        print(
            "state S3 버전·객체를 보존했습니다. 저장 비용이 남으며 재배포 시 버킷 재사용 절차가 필요합니다"
        )
    print(
        "bootstrap 삭제 완료. 외부 OIDC 공급자·최초 bootstrap 역할·DB 스냅샷은 유지합니다"
    )
