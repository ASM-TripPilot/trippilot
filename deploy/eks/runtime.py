#!/usr/bin/env python3
"""GitHub Actions deployment helper. Requires Python 3.11+, aws, kubectl and openssl."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from runtime_io import CommandError, command
import runtime_db
import runtime_secrets
import runtime_kb
import runtime_pois
import runtime_smoke

HOST_PATTERN = r"(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?"


# 배포 대상(2026-10-15 개발·운영 분리). 같은 스택·클러스터 안에서 대상마다 **네임스페이스·시크릿 그릇·DB 장비**가 다르다.
# 역할·DB 이름은 같다 — 개발 DB 가 장비째 따로라서다(#1259). 대상의 출력을 표준 키 자리에 끼워 넣으므로 소비자는 대상을 모른다.
TARGETS = {
    "prod": {"namespace": "trippilot", "app_secret_arns": "app_secret_arns", "database_host": "database_host",
             "database_master_secret_arn": "database_master_secret_arn"},
    "dev": {"namespace": "trippilot-dev", "app_secret_arns": "dev_target_secret_arns",
            "database_host": "dev_target_database_host",
            "database_master_secret_arn": "dev_target_database_master_secret_arn"},
}


def parse_outputs(raw, target="prod"):
    if target not in TARGETS:
        raise ValueError("Unknown deploy target")
    source = {key: TARGETS[target].get(key, key) for key in (
        "aws_region", "cluster_name", "database_host", "database_master_secret_arn",
        "redis_host", "ecr_repositories", "app_secret_arns")}
    if any(name not in raw or not isinstance(raw[name], dict) or "value" not in raw[name] for name in source.values()):
        raise ValueError("Missing required Terraform outputs; run terraform output -json")
    # 개발 대상 출력이 비어 있으면(스위치 꺼짐) 아래 형식 검사에서 실패한다 — 운영 값으로 떨어지지 않는다.
    result = {key: raw[name]["value"] for key, name in source.items()}
    for key in ("database_host", "redis_host"):
        if not isinstance(result[key], str) or not re.fullmatch(HOST_PATTERN, result[key]):
            raise ValueError(f"Invalid Terraform output {key}")
    if not re.fullmatch(r"[a-z]{2}(?:-[a-z]+)+-\d", result["aws_region"]):
        raise ValueError("Invalid AWS region")
    if set(result["ecr_repositories"]) != {"backend", "ai", "embedding"}:
        raise ValueError("ECR outputs must contain backend, ai, embedding")
    for repository in result["ecr_repositories"].values():
        if not re.fullmatch(r"\d{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?/[a-z0-9/_-]+", repository):
            raise ValueError("Invalid ECR repository output")
    if target != "prod" and (result["database_host"] == raw["database_host"]["value"]
                             or set(result["app_secret_arns"].values()) & set(raw["app_secret_arns"]["value"].values())):
        raise ValueError("Deploy target outputs must not point at production resources")
    if set(result["app_secret_arns"]) != set(runtime_secrets.GROUP_KEYS):
        raise ValueError("Expected backend, ai, database, shared Secrets Manager ARNs")
    for arn in [result["database_master_secret_arn"], *result["app_secret_arns"].values()]:
        if not re.fullmatch(r"arn:aws(?:-us-gov|-cn)?:secretsmanager:[a-z0-9-]+:\d{12}:secret:[a-zA-Z0-9/_+=.@!-]+", arn):
            raise ValueError("Invalid Secrets Manager ARN output")
    return result


def helm_values(outputs, image_tag, certificate_arn, hostname, embedding_enabled, embedding_image_tag=None):
    """`embedding_image_tag` 는 임베딩 빌드 맥락의 내용 해시 태그(워크플로가 계산) — 주면 임베딩만 그 태그를 쓴다.
    코드가 그대로면 태그도 그대로라 파드 템플릿이 안 바뀌고 롤아웃(= maxSurge 0 의 엔드포인트 공백)이 없다."""
    for tag in (image_tag, embedding_image_tag or image_tag):
        if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}", tag):
            raise ValueError("Invalid image tag")
    if not re.fullmatch(r"arn:aws(?:-us-gov|-cn)?:acm:[a-z0-9-]+:\d{12}:certificate/[a-f0-9-]{36}", certificate_arn):
        raise ValueError("A valid ACM certificate ARN is required")
    if certificate_arn.split(":")[3] != outputs["aws_region"]:
        raise ValueError("ACM certificate must be in the EKS/NLB AWS region")
    if not re.fullmatch(HOST_PATTERN, hostname) or "." not in hostname:
        raise ValueError("hostname must be an API DNS hostname without a URL scheme or path")
    tags = {"embedding": embedding_image_tag} if embedding_image_tag else {}
    return {
        "images": {name: {"repository": repository, "tag": tags.get(name, image_tag)}
                   for name, repository in outputs["ecr_repositories"].items()},
        "config": {"databaseHost": outputs["database_host"], "redisHost": outputs["redis_host"]},
        "gateway": {"certificateArn": certificate_arn, "hostname": hostname},
        "embedding": {"enabled": embedding_enabled},
    }


def ensure_namespace(namespace, shell):
    manifest = {"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": namespace, "labels": {
        "pod-security.kubernetes.io/enforce": "restricted", "pod-security.kubernetes.io/enforce-version": "latest",
        "pod-security.kubernetes.io/audit": "restricted", "pod-security.kubernetes.io/warn": "restricted",
    }}}
    shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest))


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="action", required=True)
    for action in ("ensure-namespace", "sync-secrets", "bootstrap-db", "cleanup-db", "render-values", "smoke", "load-kb",
                   "load-pois"):
        sub = commands.add_parser(action)
        # 네임스페이스는 대상이 정한다. 따로 주면 대상과 같아야 한다 — 개발 대상을 운영 네임스페이스에 배포하면
        # 운영 파드의 DB 비밀번호·서명키가 개발 값으로 덮인다(반대면 운영 시크릿이 개발로 샌다).
        sub.add_argument("--target", choices=tuple(TARGETS), default="prod")
        sub.add_argument("--namespace")
        if action == "load-pois":
            # 기본은 upsert 만. 퇴출(LOST)은 입력으로만 켜고, 대량 정리 가드(409)는 여기서 넘길 수 없다.
            sub.add_argument("--close-missing", action="store_true")
            # 닫힐 수만 묻고(서버 계산) 평소대로 upsert — kubectl 없이 퇴출 규모를 보는 유일한 창.
            sub.add_argument("--close-missing-dry-run", action="store_true")
        if action in ("sync-secrets", "bootstrap-db", "render-values"):
            sub.add_argument("--outputs", type=Path, required=True)
        if action in ("sync-secrets", "render-values"):
            sub.add_argument("--embedding-enabled", action="store_true")
        if action == "sync-secrets":
            # 미지정 = 시크릿에 저장된 푸시 모드 유지. 값은 백엔드가 아는 두 가지뿐이다.
            sub.add_argument("--push-mode", choices=("off", "expo"))
        if action in ("bootstrap-db", "cleanup-db"):
            sub.add_argument("--run-id", required=True)
        if action == "render-values":
            for option in ("image-tag", "certificate-arn", "hostname", "output"):
                sub.add_argument(f"--{option}", required=True)
            sub.add_argument("--embedding-image-tag")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    expected = TARGETS[args.target]["namespace"]
    if args.namespace not in (None, expected):
        raise ValueError(f"Deploy target {args.target} must use namespace {expected}")
    args.namespace = expected
    outputs = parse_outputs(json.loads(args.outputs.read_text()), args.target) if hasattr(args, "outputs") else None
    if args.action == "ensure-namespace":
        ensure_namespace(args.namespace, command)
    elif args.action == "sync-secrets":
        runtime_secrets.sync(outputs, args.namespace, args.embedding_enabled, command,
                             push_mode=args.push_mode)
    elif args.action == "bootstrap-db":
        runtime_db.bootstrap(outputs, args.namespace, args.run_id, command)
    elif args.action == "cleanup-db":
        runtime_db.cleanup(args.namespace, args.run_id, command)
    elif args.action == "smoke":
        runtime_smoke.run(args.namespace, command)
    elif args.action == "load-kb":
        runtime_kb.run(args.namespace, command)
    elif args.action == "load-pois":
        runtime_pois.run(args.namespace, command, close_missing=args.close_missing,
                         close_missing_dry_run=args.close_missing_dry_run)
    elif args.action == "render-values":
        values = helm_values(outputs, args.image_tag, args.certificate_arn, args.hostname, args.embedding_enabled,
                             args.embedding_image_tag)
        Path(args.output).write_text(json.dumps(values, indent=2) + "\n")
    print(f"{args.action}: complete")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, CommandError) as error:
        print(f"Deployment helper failed: {error}", file=sys.stderr)
        sys.exit(1)
