#!/usr/bin/env python3
"""Generate a teaching topology and actual Terraform dependency graph, offline.

The overview is a curated layout populated by a deliberately small HCL reader;
it is not a Terraform interpreter. Unsupported topology changes stop generation.
"""
import argparse
import hashlib
import ipaddress
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import hcl2

ROOT = Path(__file__).resolve().parents[3]
ASSETS = Path(__file__).resolve().parent


def load_source(root):
    documents = [hcl2.loads(path.read_text()) for path in sorted((root / "infra/terraform/stack").glob("*.tf"))]
    return {
        "resources": {f"{kind}.{name}": value for doc in documents for block in doc.get("resource", []) for kind, entries in block.items() for name, value in entries.items()},
        "locals": {key: value for doc in documents for block in doc.get("locals", []) for key, value in block.items()},
        "defaults": {name: attrs["default"] for doc in documents for block in doc.get("variable", []) for name, attrs in block.items() if "default" in attrs},
        "environments": {env: hcl2.loads((root / f"infra/terraform/environments/{env}.tfvars").read_text()) for env in ("dev", "prd")},
        "bootstrap": json.loads((root / "infra/bootstrap/template.json").read_text())["Resources"],
        "services": (root / "deploy/eks/chart/templates/services.yaml").read_text(),
    }


def evaluate(value, variables, locals_):
    if not isinstance(value, str) or not value.startswith("${"):
        return value
    expression = value[2:-1].strip()
    if re.fullmatch(r"var\.\w+", expression):
        return variables[expression[4:]]
    if expression == 'var.environment == "prd"':
        return variables["environment"] == "prd"
    if re.fullmatch(r"local\.\w+", expression):
        return evaluate(locals_[expression[6:]], variables, locals_)
    conditional = re.fullmatch(r"(var\.\w+|local\.\w+) \? (\d+|var\.\w+) : (\d+|var\.\w+)", expression)
    if conditional:
        test, positive, negative = conditional.groups()
        selected = positive if evaluate("${" + test + "}", variables, locals_) else negative
        return int(selected) if selected.isdigit() else evaluate("${" + selected + "}", variables, locals_)
    raise ValueError(f"Unsupported diagram expression: {value}")


def subnet_cidr(vpc, expression, index):
    match = re.fullmatch(r"\$\{cidrsubnet\(var.vpc_cidr, (\d+), count.index(?: \+ (\d+))?\)\}", expression)
    if not match:
        raise ValueError(f"Unsupported subnet formula: {expression}")
    newbits, offset = match.groups()
    network = ipaddress.ip_network(vpc)
    prefix = network.prefixlen + int(newbits)
    address = int(network.network_address) + (index + int(offset or 0)) * 2 ** (32 - prefix)
    subnet = ipaddress.ip_network((address, prefix))
    if not subnet.subnet_of(network):
        raise ValueError("Subnet formula exceeds VPC range")
    return str(subnet)


def validate_topology(source):
    resources = source["resources"]
    cluster = resources["aws_eks_cluster.this"]
    if cluster["compute_config"][0]["enabled"] is not True:
        raise ValueError("Overview requires EKS Auto Mode; update the teaching layout")
    if cluster["vpc_config"][0]["subnet_ids"] != "${aws_subnet.private[*].id}":
        raise ValueError("EKS subnet selection changed; update the teaching layout")
    if any(key.startswith("aws_route.") and value.get("route_table_id") == "${aws_route_table.data.id}" for key, value in resources.items()):
        raise ValueError("Data subnets are no longer isolated; update the teaching layout")
    if "eks.amazonaws.com/nlb" not in source["services"] or "internet-facing" not in source["services"]:
        raise ValueError("Helm gateway changed; update the teaching layout")
    if source["bootstrap"]["TerraformStateBucket"]["Type"] != "AWS::S3::Bucket":
        raise ValueError("Bootstrap state owner changed")
    contracts = [
        *((f"aws_subnet.{tier}", "count", "${var.availability_zone_count}") for tier in ("public", "private", "data")),
        ("aws_db_subnet_group.postgres", "subnet_ids", "${aws_subnet.data[*].id}"),
        ("aws_elasticache_subnet_group.redis", "subnet_ids", "${aws_subnet.data[*].id}"),
        ("aws_db_instance.postgres", "db_subnet_group_name", "${aws_db_subnet_group.postgres.name}"),
        ("aws_elasticache_replication_group.redis", "subnet_group_name", "${aws_elasticache_subnet_group.redis.name}"),
    ]
    for resource, attribute, expected in contracts:
        if resources[resource].get(attribute) != expected:
            raise ValueError(f"Unsupported topology change: {resource}.{attribute}; update the teaching layout")


def build_model(source, environment):
    if environment not in ("dev", "prd"):
        raise ValueError("Environment must be dev or prd")
    validate_topology(source)
    variables = {**source["defaults"], **source["environments"][environment]}
    resources, locals_ = source["resources"], source["locals"]
    resolve = lambda value: evaluate(value, variables, locals_)
    az_count = variables["availability_zone_count"]
    return {
        "environment": environment, "region": variables["aws_region"],
        "vpc": resolve(resources["aws_vpc.this"]["cidr_block"]), "az_count": az_count,
        "subnets": {tier: [subnet_cidr(variables["vpc_cidr"], resources[f"aws_subnet.{tier}"]["cidr_block"], index) for index in range(az_count)] for tier in ("public", "private", "data")},
        "nat_count": resolve(resources["aws_nat_gateway.this"]["count"]),
        "eks_version": resolve(resources["aws_eks_cluster.this"]["version"]),
        "eks_pools": resources["aws_eks_cluster.this"]["compute_config"][0]["node_pools"],
        "rds_multi_az": resolve(resources["aws_db_instance.postgres"]["multi_az"]),
        "rds_engine": resources["aws_db_instance.postgres"]["engine_version"],
        "redis_nodes": resolve(resources["aws_elasticache_replication_group.redis"]["num_cache_clusters"]),
        "redis_engine": resources["aws_elasticache_replication_group.redis"]["engine_version"],
        "secret_keys": sorted(locals_["app_secret_descriptions"]),
    }


def node(name, label, x, y, width=2.9, height=0.8, fill="#ffffff", color="#3e6ed9", dashed=False):
    style = "rounded,dashed,filled" if dashed else "rounded,filled"
    return f'{name} [label={json.dumps(label, ensure_ascii=False)}, pos="{x},{y}!", width={width}, height={height}, fillcolor="{fill}", color="{color}", style="{style}"];'


def tier_cluster(name, title, cidrs, nodes):
    label = title + "\n" + "\n".join(f"AZ {index + 1}: {cidr}" for index, cidr in enumerate(cidrs))
    left, right, center = {"public": (305, 615, 460), "compute": (650, 970, 810), "data": (1005, 1355, 1180)}[name]
    return f'subgraph cluster_{name} {{ label={json.dumps(label, ensure_ascii=False)}; bb="{left},65,{right},420"; lp="{center},376"; fontsize=16; fontcolor="#23415a"; color="#bad0e4"; fillcolor="#f6faff"; style="rounded,filled"; margin=18; ' + "\n".join(nodes) + " }"


def architecture_dot(model):
    env, az = model["environment"].upper(), model["az_count"]
    nat_note = "AZ 1의 출구를 함께 사용" if model["nat_count"] == 1 else "AZ마다 출구 1개"
    rds_note = "Multi-AZ 대기 DB 포함" if model["rds_multi_az"] else "Single-AZ · 배치 AZ는 생성 시 선택"
    subnet = model["subnets"]
    diagram = [
        'digraph architecture { graph [layout=neato, overlap=true, splines=polyline, outputorder=edgesfirst, bgcolor="#ffffff", pad=0.18, fontname="Apple SD Gothic Neo", fontsize=18];',
        'node [shape=box, fontname="Apple SD Gothic Neo", fontsize=16, penwidth=1.5, margin="0.12,0.10", fixedsize=false];',
        'edge [fontname="Apple SD Gothic Neo", fontsize=13, color="#73889a", penwidth=1.4, arrowsize=0.7];',
        node("actions", "GitHub Actions\nOIDC 인증 · 배포 실행", 120, 570, 2.5, color="#6b7280", dashed=True),
        node("bootstrap", "CloudFormation 초기 준비\nIAM 역할 + S3 상태 파일 / 잠금\n기존 GitHub OIDC provider 사용", 460, 570, 3.8, 1.0, fill="#f1edff", color="#8b6abf", dashed=True),
        node("ecr", "ECR 이미지 저장소\nbackend / ai / embedding", 810, 570, 3.2, fill="#edf4ff"),
        node("secrets", f'Secrets Manager\n{len(model["secret_keys"])}개 앱 비밀 보관함 + RDS 비밀', 1150, 570, 3.7, fill="#edf4ff"),
        node("users", "사용자\nHTTPS :443", 120, 255, 2.2, color="#6b7280"),
        node("preexisting", "DNS + ACM 인증서\n배포 전에 별도 사전 준비", 120, 365, 3.0, color="#8b6abf", dashed=True),
        f'subgraph cluster_vpc {{ label="AWS {model["region"]}  /  {env} VPC {model["vpc"]}  /  가용 영역 {az}개"; bb="285,5,1375,430"; lp="830,27"; labelloc=b; fontsize=21; fontcolor="#17324d"; style="rounded"; color="#3e6ed9"; penwidth=2; margin=24;',
        tier_cluster("public", "퍼블릭 서브넷", subnet["public"], [
            node("nat", f'NAT Gateway x{model["nat_count"]} + EIP\n{nat_note}', 460, 305, 3.6, fill="#edf4ff"),
            node("nlb", "NLB :443 + ACM TLS\nHelm / Auto Mode가 생성", 460, 205, 3.6, fill="#fff2e5", color="#d2903d", dashed=True),
            node("igw", "Internet Gateway\n퍼블릭 서브넷의 인터넷 경로", 460, 115, 3.6, fill="#edf4ff"),
        ]),
        tier_cluster("compute", "앱용 프라이빗 서브넷", subnet["private"], [
            node("nodes", 'EKS Auto Mode 실행 노드\n' + ' + '.join(model["eks_pools"]) + ' 풀', 810, 305, 3.9, fill="#edf4ff"),
            node("pods", "Helm으로 앱 실행\ngateway → backend → AI\nembedding은 선택 사항", 810, 190, 3.9, 1.1, fill="#fff2e5", color="#d2903d", dashed=True),
        ]),
        tier_cluster("data", "데이터 전용 서브넷", subnet["data"], [
            node("rds", f'RDS PostgreSQL {model["rds_engine"]}\n{rds_note}\n내부 접속 · TLS :5432', 1180, 305, 4.4, 1.0, fill="#edf4ff"),
            node("redis", f'ElastiCache Redis {model["redis_engine"]} x{model["redis_nodes"]}\nTLS :6379 · 앱은 아직 미연결', 1180, 190, 4.4, fill="#edf4ff"),
            node("isolated", "Internet / NAT 기본 경로 없음", 1180, 105, 4.4, 0.45, fill="#f6faff", color="#bad0e4"),
        ]),
        "}",
        node("eks", f'EKS 제어 영역 {model["eks_version"]} · AWS 관리\n공개 + 내부 API · IAM 인증', 810, 485, 3.9, fill="#edf4ff"),
        node("logs", "CloudWatch Logs\nEKS 제어 영역 로그", 1180, 485, 3.8, fill="#edf4ff"),
        node("legend", "파랑: Terraform 관리    보라 점선: 사전 준비 / bootstrap    주황 점선: 앱 배포 단계\nAZ 1 / 2 / 3은 설명용 이름입니다. 주황 화살표: 사용자 요청 흐름 · 그 외: 접근 / 의존 관계", 725, -55, 17.8, 0.8, fill="#ffffff", color="#ffffff"),
        'actions -> bootstrap [style=dashed]; actions -> ecr [style=dashed];',
        'bootstrap -> eks [style=dashed];',
        'ecr -> nodes [style=dashed, pos="e,950,305 925,570 985,570 985,305 960,305"];',
        'eks -> nodes [style=dashed, pos="e,669,305 669,485 630,485 630,305 659,305"];',
        'eks -> logs [style=dashed, color="#3e6ed9", penwidth=2];',
        'users -> nlb [color="#d2903d", penwidth=2.5]; nlb -> pods [color="#d2903d", penwidth=2.5]; pods -> rds [color="#d2903d", penwidth=2.5];',
        'nodes -> nat [color="#54869e"]; nat -> igw [color="#54869e"];',
        'preexisting -> nlb [style=dashed, color="#8b6abf"];',
        '}',
    ]
    return "\n".join(diagram) + "\n"


def source_manifest(root):
    paths = sorted((root / "infra/terraform/stack").glob("*.tf")) + sorted((root / "infra/terraform/environments").glob("*.tfvars"))
    paths += [root / path for path in ("infra/terraform/stack/.terraform.lock.hcl", "infra/bootstrap/template.json", "deploy/eks/chart/templates/services.yaml")]
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def prepare_terraform_copy(root, destination):
    stack = root / "infra/terraform/stack"
    for path in (*stack.glob("*.tf"), stack / ".terraform.lock.hcl"):
        shutil.copyfile(path, destination / path.name)
    versions = destination / "versions.tf"
    text, count = re.subn(r'  backend "s3" \{[^}]+\}\n', "", versions.read_text())
    if count != 1:
        raise ValueError("Expected exactly one S3 backend in scratch copy")
    versions.write_text(text)


def run(command):
    return subprocess.run(command, check=True, text=True, capture_output=True).stdout


def generate(root, output, terraform="terraform", graphviz="dot", dependencies=True):
    output.mkdir(parents=True, exist_ok=True)
    source = load_source(root)
    models = {env: build_model(source, env) for env in ("dev", "prd")}
    for environment, model in models.items():
        stem = "aws-architecture" + ("-prd" if environment == "prd" else "")
        dotfile, svgfile = output / f"{stem}.dot", output / f"{stem}.svg"
        dotfile.write_text(architecture_dot(model))
        run([graphviz, "-Kneato", "-n2", "-Tsvg", str(dotfile), "-o", str(svgfile)])
    if dependencies:
        with tempfile.TemporaryDirectory(prefix="trippilot-graph-") as temporary:
            scratch = Path(temporary)
            prepare_terraform_copy(root, scratch)
            run([terraform, f"-chdir={scratch}", "init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"])
            graph = run([terraform, f"-chdir={scratch}", "graph"])
            dotfile = output / "terraform-dependencies.dot"
            dotfile.write_text(graph)
            run([graphviz, "-Tsvg", str(dotfile), "-o", str(output / "terraform-dependencies.svg")])
    manifest = source_manifest(root)
    provenance = output / "diagram-provenance.json"
    previous = json.loads(provenance.read_text()).get("dependency_graph", {}) if provenance.exists() else {}
    dependency_graph = {"source_sha256": manifest, "regenerated_this_run": True} if dependencies else {**previous, "regenerated_this_run": False}
    metadata = {"view": "source configuration; not live AWS inventory or a plan", "models": models, "overview_source_sha256": manifest, "dependency_graph": dependency_graph}
    provenance.write_text(json.dumps(metadata, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--terraform", default="terraform")
    parser.add_argument("--graphviz", default="dot")
    parser.add_argument("--overview-only", action="store_true", help="Do not regenerate the raw Terraform dependency graph")
    args = parser.parse_args()
    generate(ROOT, ASSETS, args.terraform, args.graphviz, not args.overview_only)


if __name__ == "__main__":
    main()
