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
import runtime_smoke

HOST_PATTERN = r"(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?"


def parse_outputs(raw):
    required = ("aws_region", "cluster_name", "database_host", "database_master_secret_arn",
                "redis_host", "ecr_repositories", "app_secret_arns")
    if any(key not in raw or not isinstance(raw[key], dict) or "value" not in raw[key] for key in required):
        raise ValueError("Missing required Terraform outputs; run terraform output -json")
    result = {key: raw[key]["value"] for key in required}
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
    if set(result["app_secret_arns"]) != set(runtime_secrets.GROUP_KEYS):
        raise ValueError("Expected backend, ai, database, shared Secrets Manager ARNs")
    for arn in [result["database_master_secret_arn"], *result["app_secret_arns"].values()]:
        if not re.fullmatch(r"arn:aws(?:-us-gov|-cn)?:secretsmanager:[a-z0-9-]+:\d{12}:secret:[a-zA-Z0-9/_+=.@!-]+", arn):
            raise ValueError("Invalid Secrets Manager ARN output")
    return result


def helm_values(outputs, image_tag, certificate_arn, hostname, embedding_enabled):
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}", image_tag):
        raise ValueError("Invalid image tag")
    if not re.fullmatch(r"arn:aws(?:-us-gov|-cn)?:acm:[a-z0-9-]+:\d{12}:certificate/[a-f0-9-]{36}", certificate_arn):
        raise ValueError("A valid ACM certificate ARN is required")
    if certificate_arn.split(":")[3] != outputs["aws_region"]:
        raise ValueError("ACM certificate must be in the EKS/NLB AWS region")
    if not re.fullmatch(HOST_PATTERN, hostname) or "." not in hostname:
        raise ValueError("hostname must be an API DNS hostname without a URL scheme or path")
    return {
        "images": {name: {"repository": repository, "tag": image_tag} for name, repository in outputs["ecr_repositories"].items()},
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
    for action in ("ensure-namespace", "sync-secrets", "bootstrap-db", "cleanup-db", "render-values", "smoke"):
        sub = commands.add_parser(action)
        sub.add_argument("--namespace", default="trippilot")
        if action in ("sync-secrets", "bootstrap-db", "render-values"):
            sub.add_argument("--outputs", type=Path, required=True)
        if action in ("sync-secrets", "render-values"):
            sub.add_argument("--embedding-enabled", action="store_true")
        if action in ("bootstrap-db", "cleanup-db"):
            sub.add_argument("--run-id", required=True)
        if action == "render-values":
            for option in ("image-tag", "certificate-arn", "hostname", "output"):
                sub.add_argument(f"--{option}", required=True)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", args.namespace):
        raise ValueError("Invalid Kubernetes namespace")
    outputs = parse_outputs(json.loads(args.outputs.read_text())) if hasattr(args, "outputs") else None
    if args.action == "ensure-namespace":
        ensure_namespace(args.namespace, command)
    elif args.action == "sync-secrets":
        runtime_secrets.sync(outputs, args.namespace, args.embedding_enabled, command)
    elif args.action == "bootstrap-db":
        runtime_db.bootstrap(outputs, args.namespace, args.run_id, command)
    elif args.action == "cleanup-db":
        runtime_db.cleanup(args.namespace, args.run_id, command)
    elif args.action == "smoke":
        runtime_smoke.run(args.namespace, command)
    elif args.action == "render-values":
        values = helm_values(outputs, args.image_tag, args.certificate_arn, args.hostname, args.embedding_enabled)
        Path(args.output).write_text(json.dumps(values, indent=2) + "\n")
    print(f"{args.action}: complete")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, CommandError) as error:
        print(f"Deployment helper failed: {error}", file=sys.stderr)
        sys.exit(1)
