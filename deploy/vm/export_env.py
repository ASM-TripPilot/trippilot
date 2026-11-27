#!/usr/bin/env python3
"""운영 클러스터(EKS)의 시크릿을 VM 용 env 파일로 옮긴다 — backend.env · ai.env · ai-vector.env · db.env.

어떤 키를 어느 이름으로 넣을지는 **지금 떠 있는 Deployment 의 secretKeyRef** 를 그대로 따른다.
차트를 다시 해석하지 않는 이유: 운영이 실제로 받는 값이 정본이고, 차트가 일부러 빼 둔 키
(예: GOOGLE_CLIENT_SECRET — 보내면 invalid_client)가 시크릿에 남아 있어도 따라오지 않는다.

    AWS_PROFILE=... python3 deploy/vm/export_env.py      # → deploy/vm/secrets/*.env (0600)

값은 화면에 찍지 않는다. 키 이름과 개수만 찍는다.
"""
import base64
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

NAMESPACE = "trippilot"
OUT = Path(__file__).resolve().parent / "secrets"
# 리마인드 문구는 Bedrock(대여 계정) 경로다 — VM 에서는 끄고 상수 문구로 보낸다(알림 자체는 나간다).
BACKEND_OVERRIDES = {"AI_REMINDER_COPY_MODE": "off"}


def kubectl_json(*args):
    out = subprocess.run(["kubectl", "-n", NAMESPACE, *args, "-o", "json"],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def secret_refs(deployment):
    """Deployment 첫 컨테이너의 (env 이름, 시크릿, 키, optional) 목록."""
    container = deployment["spec"]["template"]["spec"]["containers"][0]
    refs = []
    for env in container.get("env", []):
        ref = env.get("valueFrom", {}).get("secretKeyRef")
        if ref:
            refs.append((env["name"], ref["name"], ref["key"], bool(ref.get("optional"))))
    return refs


def resolve(refs, secret_data):
    """refs 를 실제 값으로. 필수 키가 없으면 멈춘다 — 빈 채로 띄우면 기능이 조용히 꺼진다."""
    values, missing = {}, []
    for env, secret, key, optional in refs:
        data = secret_data.get(secret, {})
        if key in data:
            values[env] = data[key]
        elif not optional:
            missing.append(f"{secret}/{key}")
    if missing:
        sys.exit(f"필수 시크릿 키 없음: {', '.join(missing)}")
    return values


def to_local_db(url):
    """RDS 주소를 VM 안 db 컨테이너로. 같은 박스 안이라 TLS 는 끈다."""
    url = re.sub(r"@[^/:]+(:\d+)?/", "@db:5432/", url)
    return url.replace("sslmode=require", "sslmode=disable")


def env_line(key, value):
    """compose env_file 의 큰따옴표 값 — 줄바꿈·따옴표·역슬래시·$ 를 이스케이프한다(PEM 키가 여러 줄이다)."""
    escaped = (value.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
               .replace("\r", "").replace("\n", "\\n"))
    return f'{key}="{escaped}"\n'


def write_env(name, values):
    path = OUT / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.writelines(env_line(k, v) for k, v in sorted(values.items()))
    print(f"{path.relative_to(Path.cwd()) if path.is_relative_to(Path.cwd()) else path}: {len(values)}개 — {', '.join(sorted(values))}")


def bedrock_features(ai):
    """`local*` 모델이 배정된 기능 — VM 에는 AWS 자격이 없어 Bedrock 호출이 매번 실패하고 폴백한다(리마인드는 아래에서 끈다).
    형식은 ai/src/trippilot/llm_gateway/feature_model_env.py: "FEATURE=model,FEATURE=model"."""
    pairs = (p.split("=", 1) for p in ai.get("TRIPPILOT_LLM_FEATURE_MODELS", "").split(",") if "=" in p)
    return sorted(f.strip() for f, m in pairs if m.strip().lower().startswith("local"))


def build(deployments, secret_data, postgres_password):
    backend = resolve(secret_refs(deployments["backend"]), secret_data)
    backend.update(BACKEND_OVERRIDES)
    ai = resolve(secret_refs(deployments["ai"]), secret_data)
    if "TRIPPILOT_PLACE_DB_URL" in ai:
        ai["TRIPPILOT_PLACE_DB_URL"] = to_local_db(ai["TRIPPILOT_PLACE_DB_URL"])
    # 벡터 DB 주소는 임베딩 서비스가 있을 때만 줄 수 있다(없으면 AI 가 기동 실패) — docker-compose.embedding.yml 만 읽는 파일로 뗀다.
    vector = {"TRIPPILOT_VECTOR_DB_URL": to_local_db(ai.pop("TRIPPILOT_VECTOR_DB_URL"))} if "TRIPPILOT_VECTOR_DB_URL" in ai else {}
    database = secret_data["trippilot-database"]
    db = {"POSTGRES_PASSWORD": postgres_password,
          **{k: database[k] for k in ("DB_PASSWORD", "DB_MIGRATE_PASSWORD", "AI_DB_PASSWORD")}}
    return backend, ai, vector, db


def main():
    deployments = {d: kubectl_json("get", "deployment", d) for d in ("backend", "ai")}
    names = {ref[1] for d in deployments.values() for ref in secret_refs(d)} | {"trippilot-database"}
    secret_data = {n: {k: base64.b64decode(v).decode() for k, v in (kubectl_json("get", "secret", n).get("data") or {}).items()}
                   for n in sorted(names)}
    OUT.mkdir(mode=0o700, exist_ok=True)
    old = OUT / "db.env"
    # 슈퍼유저 비밀번호는 VM 전용이라 새로 만든다. 다시 돌려도 이미 만든 값은 지키지 않으면 볼륨과 어긋난다.
    pg = re.search(r'^POSTGRES_PASSWORD="([^"]+)"', old.read_text(), re.M).group(1) if old.exists() else secrets.token_urlsafe(32)
    backend, ai, vector, db = build(deployments, secret_data, pg)
    write_env("backend.env", backend)
    write_env("ai.env", ai)
    write_env("ai-vector.env", vector)
    write_env("db.env", db)
    if features := bedrock_features(ai):
        print(f"주의: local*(Bedrock) 모델 배정 {', '.join(features)} — VM 에서는 매번 폴백한다. 리마인드 외 기능이면 "
              "secrets/ai.env 의 TRIPPILOT_LLM_FEATURE_MODELS 에서 그 기능을 claude 모델로 바꾼다.")


if __name__ == "__main__":
    main()
