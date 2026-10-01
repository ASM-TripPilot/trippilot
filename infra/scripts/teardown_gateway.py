"""EKS가 살아 있는 동안 NLB를 정리하고 클러스터 삭제를 허용한다."""

import json
import time

from teardown_config import matched

GATEWAY_TIMEOUT = 1200
POLL_SECONDS = 5


def aws_query(run, service, operation, *arguments):
    return json.loads(
        run(
            [
                "aws",
                service,
                operation,
                *arguments,
                "--output",
                "json",
                "--cli-connect-timeout",
                "5",
                "--cli-read-timeout",
                "15",
            ],
            quiet=True,
            env={"AWS_MAX_ATTEMPTS": "1"},
        )
    )


def live_cluster(run, settings, resources):
    clusters = aws_query(run, "eks", "list-clusters")["clusters"]
    if not isinstance(clusters, list) or any(
        not isinstance(item, str) for item in clusters
    ):
        raise ValueError("EKS 클러스터 목록 형식이 올바르지 않습니다")
    if settings.cluster not in clusters:
        return None
    saved = resources.get("aws_eks_cluster.this")
    if not saved:
        raise ValueError("선택한 EKS가 Terraform state 밖에 존재합니다")
    cluster = aws_query(run, "eks", "describe-cluster", "--name", settings.cluster)[
        "cluster"
    ]
    arn = f"arn:aws:eks:{settings.region}:{settings.account}:cluster/{settings.cluster}"
    vpc = resources.get("aws_vpc.this", {}).get("id")
    if (
        cluster.get("arn") != arn
        or saved.get("arn") != arn
        or cluster.get("name") != settings.cluster
        or not vpc
        or cluster.get("resourcesVpcConfig", {}).get("vpcId") != vpc
        or not saved.get("endpoint")
        or cluster.get("endpoint") != saved["endpoint"]
        or cluster.get("status") not in {"ACTIVE", "DELETING"}
    ):
        raise ValueError("실제 EKS 신원·VPC·endpoint·상태가 삭제 대상과 다릅니다")
    return cluster


def validate_nlb(item, settings, resources):
    subnets = {
        value["id"]
        for address, value in resources.items()
        if address.startswith("aws_subnet.public[")
    }
    if (
        item.get("Type") != "network"
        or item.get("Scheme") != "internet-facing"
        or len(subnets) < 2
        or {zone["SubnetId"] for zone in item.get("AvailabilityZones", [])} != subnets
    ):
        raise ValueError("삭제 대상 VPC의 NLB 타입·subnet이 state와 다릅니다")
    matched(
        rf"arn:aws:elasticloadbalancing:{settings.region}:{settings.account}:loadbalancer/net/[a-zA-Z0-9-]+/[a-f0-9]+",
        item.get("LoadBalancerArn"),
        "삭제 대상 NLB ARN",
    )


def matching_nlbs(run, settings, resources):
    vpc = resources.get("aws_vpc.this", {}).get("id")
    if not vpc:
        return []
    matched(r"vpc-(?:[a-f0-9]{8}|[a-f0-9]{17})", vpc, "삭제 대상 VPC")
    candidates = aws_query(run, "elbv2", "describe-load-balancers")["LoadBalancers"]
    if not isinstance(candidates, list):
        raise TypeError("NLB 목록 형식이 올바르지 않습니다")
    matching = [item for item in candidates if item.get("VpcId") == vpc]
    if len(matching) > 1:
        raise ValueError("선택한 VPC에 예상보다 많은 로드 밸런서가 있습니다")
    for item in matching:
        validate_nlb(item, settings, resources)
        verify_nlb_tags(run, settings, item['LoadBalancerArn'])
    return matching


def verify_nlb_tags(run, settings, arn):
    descriptions = aws_query(run, 'elbv2', 'describe-tags', '--resource-arns', arn).get('TagDescriptions')
    if not isinstance(descriptions, list) or len(descriptions) != 1 or descriptions[0].get('ResourceArn') != arn:
        raise ValueError('NLB 태그 조회의 리소스 ARN이 다릅니다')
    items = descriptions[0].get('Tags')
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError('NLB 태그 형식이 올바르지 않습니다')
    tags = {item.get('Key'): item.get('Value') for item in items}
    if len(tags) != len(items) or tags.get('eks:eks-cluster-name') != settings.cluster or tags.get('service.eks.amazonaws.com/stack') != 'trippilot/gateway':
        raise ValueError('NLB가 선택한 EKS gateway 소유 리소스가 아닙니다')


def get_service(run):
    raw = run(
        [
            "kubectl",
            "-n",
            "trippilot",
            "get",
            "service",
            "gateway",
            "--ignore-not-found",
            "-o",
            "json",
            "--request-timeout=15s",
        ],
        quiet=True,
    )
    return json.loads(raw) if raw.strip() else None


def validate_service(service, settings, nlbs):
    if service is None:
        return
    metadata = service.get("metadata", {})
    annotations = metadata.get("annotations", {})
    if (
        metadata.get("name") != "gateway"
        or metadata.get("namespace") != "trippilot"
        or annotations.get("meta.helm.sh/release-name") != "trippilot"
        or annotations.get("meta.helm.sh/release-namespace") != "trippilot"
        or service.get("spec", {}).get("type") != 'LoadBalancer'
        or service.get("spec", {}).get("loadBalancerClass") != 'eks.amazonaws.com/nlb'
    ):
        raise ValueError(
            "Service가 선택한 환경의 TripPilot Helm 소유 리소스가 아닙니다"
        )
    endpoints = service.get("status", {}).get("loadBalancer", {}).get("ingress", [])
    hosts = {item.get("hostname") for item in endpoints}
    if hosts and nlbs and hosts != {item["DNSName"] for item in nlbs}:
        raise ValueError("Service DNS와 확인한 NLB가 다릅니다")


def helm_release(run):
    releases = json.loads(
        run(
            [
                "helm",
                "list",
                "--namespace",
                "trippilot",
                "--all",
                "--filter",
                "^trippilot$",
                "--output",
                "json",
            ],
            quiet=True,
        )
    )
    if not isinstance(releases, list) or len(releases) > 1:
        raise ValueError("Helm release 목록을 하나로 식별하지 못했습니다")
    if releases and (
        releases[0].get("name") != "trippilot"
        or releases[0].get("namespace") != "trippilot"
    ):
        raise ValueError("Helm release의 이름·namespace가 다릅니다")
    return bool(releases)


def wait_gateway_absent(run, settings, resources, timeout=GATEWAY_TIMEOUT):
    deadline = time.monotonic() + timeout
    while True:
        service = get_service(run)
        nlbs = matching_nlbs(run, settings, resources)
        if service is None and not nlbs:
            return
        if time.monotonic() >= deadline:
            raise TimeoutError(
                "Service·NLB 정리 대기 시간을 초과했습니다. finalizer는 강제로 제거하지 않습니다"
            )
        time.sleep(POLL_SECONDS)


def gateway_cleanup_available(cluster, nlbs, resources):
    if cluster is None or cluster["status"] == "DELETING":
        if nlbs:
            raise RuntimeError(
                "EKS가 없거나 삭제 중인데 NLB가 남았습니다. orphan 리소스를 조사하세요"
            )
        return False
    if not all(
        address in resources
        for address in (
            "aws_eks_access_entry.deployment",
            "aws_eks_access_policy_association.deployment",
        )
    ):
        if nlbs:
            raise RuntimeError(
                "EKS 배포 접근 권한이 state에 없는데 NLB가 남았습니다. 접근 권한을 복구해 정리하세요"
            )
        print("EKS 접근 리소스와 NLB가 이미 제거되어 Kubernetes 정리를 생략합니다")
        return False
    return True


def remove_gateway(run, settings, resources):
    cluster = live_cluster(run, settings, resources)
    nlbs = matching_nlbs(run, settings, resources)
    if not gateway_cleanup_available(cluster, nlbs, resources):
        return
    run(
        [
            "aws",
            "eks",
            "update-kubeconfig",
            "--name",
            settings.cluster,
            "--region",
            settings.region,
        ],
        quiet=True,
    )
    service = get_service(run)
    validate_service(service, settings, nlbs)
    release = helm_release(run)
    if service is not None:
        delete_service(run)
    wait_gateway_absent(run, settings, resources)
    if release:
        run(
            [
                "helm",
                "uninstall",
                "trippilot",
                "--namespace",
                "trippilot",
                "--no-hooks",
                "--wait",
                "--timeout",
                "10m",
            ],
            quiet=True,
        )
    print("Service·NLB 정리와 Helm 해제 확인 완료")


def delete_service(run):
    run(
        [
            "kubectl",
            "-n",
            "trippilot",
            "delete",
            "service",
            "gateway",
            "--ignore-not-found",
            "--wait=false",
            "--request-timeout=15s",
        ],
        quiet=True,
    )
