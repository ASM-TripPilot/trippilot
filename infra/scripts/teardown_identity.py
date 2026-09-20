"""삭제 전 Terraform state의 환경 소유권과 리소스 참조를 제한한다."""

import re

TAGGED_ADDRESSES = (
    r"aws_vpc\.this",
    r"aws_internet_gateway\.this",
    r"aws_subnet\.(public|private|data)\[[0-2]\]",
    r"aws_route_table\.(public|data|private\[[0-2]\])",
    r"aws_eip\.nat\[[0-2]\]",
    r"aws_nat_gateway\.this\[[0-2]\]",
    r"aws_security_group\.(redis|postgres)",
    r'aws_vpc_security_group_ingress_rule\.(postgres_from_eks|redis_from_eks)',
    r"aws_db_(instance|subnet_group|parameter_group)\.postgres",
    r"aws_cloudwatch_log_group\.eks",
    r"aws_eks_cluster\.this",
    r"aws_eks_access_entry\.deployment",
    r'aws_ecr_repository\.app\["(backend|ai|embedding)"\]',
    r'aws_secretsmanager_secret\.app\["(backend|ai|database|shared)"\]',
    r"aws_elasticache_(subnet_group|replication_group)\.redis",
)


def validate_tags_and_arn(value, settings):
    tags = value.get("tags_all", {})
    expected = {
        "Project": "trippilot",
        "Environment": settings.environment,
        "ManagedBy": "terraform",
    }
    if not isinstance(tags, dict) or any(
        tags.get(key) != item for key, item in expected.items()
    ):
        raise ValueError(
            "삭제 대상 state의 Project·Environment·ManagedBy 태그가 다릅니다"
        )
    arn = value.get("arn")
    if arn and (
        not isinstance(arn, str)
        or not re.match(
            rf"^arn:aws:[a-z0-9-]+:{settings.region}:{settings.account}:", arn
        )
    ):
        raise ValueError("삭제 대상 state의 ARN 계정·리전이 다릅니다")


def reference(value, key, resources, address_prefix):
    allowed = {
        item.get("id")
        for address, item in resources.items()
        if address.startswith(address_prefix)
    } - {None}
    if not value.get(key) or value[key] not in allowed:
        raise ValueError(
            "태그 없는 삭제 리소스가 검증된 환경의 부모 리소스를 참조하지 않습니다"
        )


def validate_tagless(address, value, resources, settings):
    if re.fullmatch(r"aws_route\.(internet|nat\[[0-2]\])", address):
        reference(value, "route_table_id", resources, "aws_route_table.")
    elif re.fullmatch(
        r"aws_route_table_association\.(public|private|data)\[[0-2]\]", address
    ):
        reference(value, "route_table_id", resources, "aws_route_table.")
        reference(value, "subnet_id", resources, "aws_subnet.")
    elif re.fullmatch(
        r'aws_ecr_lifecycle_policy\.app\["(backend|ai|embedding)"\]', address
    ):
        repository = resources.get(
            address.replace("aws_ecr_lifecycle_policy", "aws_ecr_repository"), {}
        )
        if not value.get("repository") or value["repository"] != repository.get("name"):
            raise ValueError("ECR 정책의 저장소가 검증된 환경과 다릅니다")
    elif address == "aws_eks_access_policy_association.deployment":
        if (
            value.get("cluster_name") != settings.cluster
            or value.get("principal_arn") != settings.role
        ):
            raise ValueError("EKS 접근 정책의 클러스터·역할이 삭제 환경과 다릅니다")
    else:
        raise ValueError(
            "현재 TripPilot 소스에 없는 managed 리소스를 삭제하지 않습니다"
        )


def validate_owned_state(resources, settings):
    vpc_id = resources.get("aws_vpc.this", {}).get("id")
    for address, value in resources.items():
        if any(re.fullmatch(pattern, address) for pattern in TAGGED_ADDRESSES):
            validate_tags_and_arn(value, settings)
        else:
            validate_tagless(address, value, resources, settings)
        detached_gateway = (
            address == "aws_internet_gateway.this" and value.get("vpc_id") == ""
        )
        if detached_gateway and not value.get("arn"):
            raise ValueError("분리된 Internet Gateway의 소유권 ARN이 없습니다")
        if (
            "vpc_id" in value
            and not detached_gateway
            and (not vpc_id or value["vpc_id"] != vpc_id)
        ):
            raise ValueError("삭제 대상 state의 VPC 참조가 선택한 환경과 다릅니다")
        if address.startswith("aws_nat_gateway."):
            reference(value, "subnet_id", resources, "aws_subnet.public[")
        if (
            address == "aws_eks_cluster.this"
            and value.get("arn")
            != f"arn:aws:eks:{settings.region}:{settings.account}:cluster/{settings.cluster}"
        ):
            raise ValueError("삭제 대상 EKS ARN이 선택한 환경과 다릅니다")
        if address == 'aws_elasticache_replication_group.redis' and (
            value.get('replication_group_id') != settings.cluster
            or value.get('arn') != f'arn:aws:elasticache:{settings.region}:{settings.account}:replicationgroup:{settings.cluster}'
        ):
            raise ValueError('Redis 이름·ARN이 선택한 환경과 다릅니다')
