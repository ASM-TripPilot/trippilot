"""Allowlisted Secrets Manager JSON -> service-scoped Kubernetes Secrets."""
import base64
import json
import os
import secrets
import shutil
import subprocess
import tempfile
from urllib.parse import quote

from runtime_io import CommandError

BACKEND_KEYS = frozenset("""
JWT_SIGNING_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET KAKAO_CLIENT_ID
KAKAO_CLIENT_SECRET NAVER_CLIENT_ID NAVER_CLIENT_SECRET APPLE_CLIENT_ID WEATHER_API
APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY SOCIAL_TOKEN_ENCRYPTION_KEY
PUSH_EXPO_ACCESS_TOKEN PLACE_GEOCODE_MODE WEATHER_MODE PUSH_MODE AI_REMINDER_COPY_MODE
""".split())
AI_KEYS = frozenset("""
TRIPPILOT_LLM_PROVIDER OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL OPENAI_API
ANTHROPIC_API_KEY ANTHROPIC_MODEL TRIPPILOT_LLM_FEATURE_MODELS TRIPPILOT_LLM_RETRY_MODELS
TRIPPILOT_LOCAL_LLM_BASE_URL TRIPPILOT_LOCAL_LLM_API_KEY WEATHER_API KAKAO_REST_API_KEY
EXISTENCE_MAX_CALLS TMAP_API_KEY TRIPPILOT_EMBEDDING_TIMEOUT_SEC TRIPPILOT_EMBEDDING_MODEL
TRIPPILOT_BEDROCK_MODEL_ARN TRIPPILOT_BEDROCK_REGION
""".split())
GROUP_KEYS = {
    "backend": BACKEND_KEYS, "ai": AI_KEYS,
    "database": frozenset(("DB_PASSWORD", "DB_MIGRATE_PASSWORD", "AI_DB_PASSWORD")),
    "shared": frozenset(("SERVICE_AUTH_TOKEN",)),
}
BACKEND_DEFAULTS = {
    "PLACE_GEOCODE_MODE": "stub", "WEATHER_MODE": "fake",
    "PUSH_MODE": "off", "AI_REMINDER_COPY_MODE": "http",
}


def get_secret(shell, region, arn, *, strings_only=True):
    try:
        raw = shell(["aws", "secretsmanager", "get-secret-value", "--region", region,
                     "--secret-id", arn, "--output", "json"])
    except CommandError as error:
        if "ResourceNotFoundException" in error.detail:
            return {}  # Terraform creates containers; the first deploy creates AWSCURRENT.
        raise
    try:
        value = json.loads(json.loads(raw)["SecretString"])
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError("Secrets Manager value must be a JSON object of strings") from error
    if not isinstance(value, dict) or (strings_only and any(not isinstance(v, str) or "\x00" in v for v in value.values())):
        raise ValueError("Secrets Manager value must be a JSON object of strings")
    return value


def put_secret(shell, region, arn, values):
    # Values never travel on command arguments, logs, or Terraform state.
    # stdin(file:///dev/stdin) is NOT an option: the aws CLI v2 paramfile loader
    # cannot read pipes and fails with "Invalid JSON received" (measured 2026-09-19,
    # runs 35388660238/35389564380/35390200513 — mock-shell tests cannot catch this).
    # A 0600 file inside a private 0700 temp dir on the throwaway runner disk,
    # removed immediately after the call, preserves the same secrecy property.
    directory = tempfile.mkdtemp()
    try:
        path = os.path.join(directory, "payload.json")
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump({"SecretId": arn, "SecretString": json.dumps(values)}, stream)
        shell(["aws", "secretsmanager", "put-secret-value", "--region", region,
               "--cli-input-json", f"file://{path}", "--output", "json"])
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def rsa_key():
    generated = subprocess.run(
        ["openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048"],
        capture_output=True, check=False,
    )
    if generated.returncode:
        raise ValueError("Failed to generate JWT RSA key")
    converted = subprocess.run(
        ["openssl", "pkcs8", "-topk8", "-nocrypt", "-outform", "DER"],
        input=generated.stdout, capture_output=True, check=False,
    )
    if converted.returncode:
        raise ValueError("Failed to encode JWT PKCS#8 key")
    return base64.b64encode(converted.stdout).decode("ascii")


def validate_rsa_key(value):
    try:
        decoded = base64.b64decode(value, validate=True)
    except ValueError as error:
        raise ValueError("JWT_SIGNING_KEY must be base64 PKCS#8 RSA") from error
    pkcs8 = subprocess.run(
        ["openssl", "pkcs8", "-inform", "DER", "-nocrypt"],
        input=decoded, capture_output=True, check=False,
    )
    if pkcs8.returncode:
        raise ValueError("JWT_SIGNING_KEY must be base64 PKCS#8 RSA")
    checked = subprocess.run(
        ["openssl", "rsa", "-inform", "DER", "-check", "-noout"],
        input=decoded, capture_output=True, check=False,
    )
    if checked.returncode:
        raise ValueError("JWT_SIGNING_KEY must be base64 PKCS#8 RSA")


def seed_groups(groups, password_factory=None, key_factory=None):
    password_factory = password_factory or (lambda: secrets.token_urlsafe(36))
    key_factory = key_factory or rsa_key
    backend = {**BACKEND_DEFAULTS, **groups["backend"]}
    return {
        "backend": {**backend, "JWT_SIGNING_KEY": backend.get("JWT_SIGNING_KEY") or key_factory()},
        "database": {key: groups["database"].get(key) or password_factory() for key in GROUP_KEYS["database"]},
        "shared": {"SERVICE_AUTH_TOKEN": groups["shared"].get("SERVICE_AUTH_TOKEN") or password_factory()},
        "ai": {**groups["ai"]},
    }


def require(values, keys, condition):
    if any(not isinstance(values.get(key), str) or not values[key].strip() for key in keys):
        raise ValueError(f"{condition} requires configured keys: {', '.join(keys)}")


def validate_groups(groups):
    for group, allowed in GROUP_KEYS.items():
        values = groups[group]
        if set(values) - allowed:
            raise ValueError(f"Unsupported key in {group} secret; use deploy/eks/runtime_secrets.py allowlist")
        if any(not isinstance(value, str) or "\x00" in value for value in values.values()):
            raise ValueError(f"{group} secret values must be strings without NUL")
    backend, ai = groups["backend"], groups["ai"]
    modes = {"PLACE_GEOCODE_MODE": {"stub", "kakao"}, "WEATHER_MODE": {"fake", "kma"},
             "PUSH_MODE": {"off", "expo"}, "AI_REMINDER_COPY_MODE": {"off", "http"}}
    for key, allowed in modes.items():
        if key in backend and backend[key] not in allowed:
            raise ValueError(f"Unsupported {key} in backend secret")
    # 현재 구글 클라이언트는 **공개(iOS) 유형**이라 client_secret 을 보내면 Google 이 invalid_client 로
    # 거절한다(2026-09-23 실측 — 생략하면 invalid_grant 로 통과). 백엔드는 빈 값이면 전송을 생략하므로
    # 부재·빈 값은 정상이고, **값이 차 있는 것만** 막는다. 목록에서 키를 빼지 않는 이유는 이미 그 값이
    # 들어 있는 시크릿의 배포 전체를 검증에서 죽이지 않기 위해서다 — 여기서 이유와 함께 크게 실패시킨다.
    # Web 유형 클라이언트로 바꾸면 이 가드를 지운다.
    if backend.get("GOOGLE_CLIENT_SECRET", "").strip():
        raise ValueError(
            "GOOGLE_CLIENT_SECRET must stay empty: the Google client is a public (iOS) client, "
            "so sending a secret makes Google reject the exchange with invalid_client"
        )
    if backend.get("PLACE_GEOCODE_MODE") == "kakao":
        require(backend, ("KAKAO_CLIENT_ID",), "kakao geocoding")
    if backend.get("WEATHER_MODE") == "kma":
        require(backend, ("WEATHER_API",), "kma weather")
    provider = ai.get("TRIPPILOT_LLM_PROVIDER", "")
    if provider not in ("", "openai", "anthropic", "mixed"):
        raise ValueError("Unsupported TRIPPILOT_LLM_PROVIDER in ai secret")
    if provider in ("openai", "mixed"):
        require(ai, ("OPENAI_API_KEY",), "OpenAI LLM")
    if provider in ("anthropic", "mixed"):
        require(ai, ("ANTHROPIC_API_KEY",), "Anthropic LLM")


def runtime_manifests(groups, outputs, namespace, embedding_enabled):
    vector = {"TRIPPILOT_VECTOR_DB_URL": (
        f"postgresql://ai_user:{quote(groups['database']['AI_DB_PASSWORD'], safe='')}"
        f"@{outputs['database_host']}:5432/ai_kb?sslmode=require"
    )} if embedding_enabled else {}
    values = {**groups, "ai": {**groups["ai"], **vector}}
    return [{"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
             "metadata": {"name": f"trippilot-{name}", "namespace": namespace},
             "stringData": values[name]} for name in GROUP_KEYS]


def sync(outputs, namespace, embedding_enabled, shell):
    region = outputs["aws_region"]
    groups = {name: get_secret(shell, region, arn) for name, arn in outputs["app_secret_arns"].items()}
    validate_groups(groups)
    seeded = seed_groups(groups)
    validate_rsa_key(seeded["backend"]["JWT_SIGNING_KEY"])
    for name, values in seeded.items():
        if values != groups[name]:
            put_secret(shell, region, outputs["app_secret_arns"][name], values)
    for manifest in runtime_manifests(seeded, outputs, namespace, embedding_enabled):
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest))
