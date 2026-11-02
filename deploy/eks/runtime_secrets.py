"""Allowlisted Secrets Manager JSON -> service-scoped Kubernetes Secrets."""
import ast
import base64
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import uuid
from urllib.parse import quote

from runtime_io import CommandError

BACKEND_KEYS = frozenset("""
JWT_SIGNING_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET KAKAO_CLIENT_ID
KAKAO_CLIENT_SECRET NAVER_CLIENT_ID NAVER_CLIENT_SECRET APPLE_CLIENT_ID WEATHER_API
APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY SOCIAL_TOKEN_ENCRYPTION_KEY
PUSH_EXPO_ACCESS_TOKEN PLACE_GEOCODE_MODE WEATHER_MODE PUSH_MODE AI_REMINDER_COPY_MODE
AFFILIATE_MODE TRIPCOM_ALLIANCE_ID TRIPCOM_SID TRIPCOM_AD_ID
ITINERARY_GENERATION_DAILY_LIMIT ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS SHARE_CARD_DAILY_LIMIT
KAKAO_APP_ID ASSISTANT_INTERPRET_MODE LOCATION_AUTOMATION_ENABLED PUBLIC_DATA_API_KEY
PLANB_SITUATION_SWEEP PLANB_SITUATION_HORIZON PLANB_SITUATION_SWEEP_ACCOUNT_IDS PLANB_PREPARED_REPLAN
GOOGLE_WEB_CLIENT_ID GOOGLE_WEB_CLIENT_SECRET CORS_ALLOWED_ORIGINS
""".split())
AI_KEYS = frozenset("""
TRIPPILOT_LLM_PROVIDER OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL OPENAI_API
ANTHROPIC_API_KEY ANTHROPIC_MODEL TRIPPILOT_LLM_FEATURE_MODELS TRIPPILOT_LLM_RETRY_MODELS
TRIPPILOT_LOCAL_LLM_BASE_URL TRIPPILOT_LOCAL_LLM_API_KEY WEATHER_API WEATHER_API_BASE KAKAO_REST_API_KEY
EXISTENCE_MAX_CALLS TMAP_API_KEY ODSAY_API_KEY TRIPPILOT_EMBEDDING_TIMEOUT_SEC TRIPPILOT_EMBEDDING_MODEL
TRIPPILOT_BEDROCK_MODEL_ARN TRIPPILOT_BEDROCK_REGION
TRIPPILOT_DIALOGUE_ORCHESTRATOR TRIPPILOT_DIALOGUE_SHADOW_RATE PUBLIC_DATA_API_KEY
HOLIDAY_CLOSURE_MODE
""".split())
GROUP_KEYS = {
    "backend": BACKEND_KEYS, "ai": AI_KEYS,
    "database": frozenset(("DB_PASSWORD", "DB_MIGRATE_PASSWORD", "AI_DB_PASSWORD")),
    "shared": frozenset(("SERVICE_AUTH_TOKEN",)),
}
BACKEND_DEFAULTS = {
    "PLACE_GEOCODE_MODE": "stub", "WEATHER_MODE": "fake",
    "PUSH_MODE": "off", "AI_REMINDER_COPY_MODE": "http",
    "AFFILIATE_MODE": "fallback",
    # 도우미 발화 해석(U8 REL-U8-06). 앱 기본값은 fake(로컬용 낱말 표)라, 여기서 off 를 심지 않으면
    # 운영이 대역으로 뜬다. off = 버튼 모드. 상대 경계(TRIP-1410)와 월 상한(20,000 턴)이 섰으므로 켜려면 시크릿 값만
    # http 로 바꾼다 — 새로 까는 환경의 기본은 여전히 off 다(켜는 것은 환경마다의 결정).
    "ASSISTANT_INTERPRET_MODE": "off",
}
# 배포 입력 `runtime_switches` 로 쓸 수 있는 키 → 그룹(상황 감지 스위치). 값 검증은 validate_groups 가 이미 한다.
RUNTIME_SWITCHES = {"PLANB_SITUATION_SWEEP": "backend", "PLANB_SITUATION_HORIZON": "backend",
                    "PLANB_SITUATION_SWEEP_ACCOUNT_IDS": "backend", "PLANB_PREPARED_REPLAN": "backend",
                    "HOLIDAY_CLOSURE_MODE": "ai"}


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


# 대상별 AI 기본값 — 저장값이 **없을 때만** 깔고(그 런에서 시크릿에 써서 남긴다) 저장값이 있으면 그대로 둔다.
# 섀도 분류 측정 비율은 사용자 결정(2026-10-17)이 개발 1.0 · 운영 0.2 다. AI 기본값이 1.0 이라 운영만 여기서 내린다.
AI_TARGET_DEFAULTS = {"prod": {"TRIPPILOT_DIALOGUE_SHADOW_RATE": "0.2"}}
# 같은 커밋 AI 의 기능 enum. 배포 러너는 AI 패키지를 설치하지 않으므로 소스를 읽는다(runtime_pois 의 SCRIPT 와 같은 방식).
FEATURE_SOURCE = Path(__file__).resolve().parents[2] / "ai" / "src" / "trippilot" / "domain" / "llm.py"
_MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/@+-]*")


def known_llm_features(source=FEATURE_SOURCE):
    """같은 커밋 `LlmFeature` 의 **값**들(AI 는 `LlmFeature(name)` 으로 값을 찾는다). 정규식 대신 AST — 접두가 같은 다른
    클래스나 모듈 상수를 잘못 집지 않게. 모르는 이름이 배정에 들어가면 AI 가 기동에서 죽는다(`feature_models_from_env`)."""
    tree = ast.parse(source.read_text(encoding="utf-8"))
    enum = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "LlmFeature"), None)
    if enum is None:
        raise ValueError(f"LlmFeature enum not found in {source}")
    return frozenset(stmt.value.value for stmt in enum.body
                     if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Constant)
                     and isinstance(stmt.value.value, str))


_RUNNING_FEATURES = "from trippilot.domain.llm import LlmFeature; print(' '.join(f.value for f in LlmFeature))"


def running_llm_features(namespace, shell):
    """**지금 떠 있는** AI 이미지의 기능 이름 — AI Deployment 가 없으면(첫 설치) None.

    왜: sync 는 helm 보다 먼저 시크릿과 k8s Secret 을 덮고, helm --atomic 롤백은 그 Secret 을 되돌리지 않는다(차트 밖 리소스).
    새 이름을 넣은 런이 롤백되면 옛 이미지 파드가 다음 재시작 때 그 이름을 읽고 기동에서 죽는다. 그래서 새 이름은 그 이름을
    아는 이미지가 이미 떠 있을 때만 받는다. exec 가 실패하면 그대로 올려 배포를 멈춘다(쓰기 전 — 닫힌 쪽으로 실패).
    """
    found = shell(["kubectl", "get", "deployment", "ai", "--namespace", namespace, "--ignore-not-found", "--output", "name"])
    if not found.strip():
        return None
    output = shell(["kubectl", "exec", "--namespace", namespace, "deployment/ai", "-c", "ai", "--",
                    "env", "PYTHONPATH=/app/src", "/app/.venv/bin/python", "-c", _RUNNING_FEATURES])
    return frozenset(output.split())


def merge_feature_models(stored, overrides, known, running=None):
    """`FEATURE=model,…` 를 저장된 배정 위에 덧씌운다 — 같은 기능은 자리 그대로 바꾸고, 새 기능은 뒤에 붙이고, 나머지는 둔다.
    결과 전체가 이 커밋(`known`)과 지금 떠 있는 이미지(`running`, None 이면 생략) 양쪽이 아는 이름이어야 한다. 지우는 문법은
    두지 않는다 — 항목을 빼는 것은 시크릿 손편집 몫이다(덧씌우기만으로 롤아웃은 끝난다)."""
    pairs = {}
    for pair in (stored or "").split(","):
        name, sep, model = pair.partition("=")
        if sep and name.strip():
            pairs[name.strip().upper()] = model.strip()  # AI 도 이름을 대문자로 읽는다
    for pair in overrides.split(","):
        if not pair.strip():
            continue
        name, sep, model = (part.strip() for part in pair.partition("="))
        if not sep or not _MODEL_ID.fullmatch(model):
            raise ValueError("llm feature models must be FEATURE=model pairs separated by commas")
        pairs[name.upper()] = model
    unknown = sorted(name for name in pairs if name not in known)
    if unknown:
        raise ValueError(f"Unknown LlmFeature in llm feature models: {', '.join(unknown)}")
    if running is not None:
        not_running = sorted(name for name in pairs if name not in running)
        if not_running:
            raise ValueError(f"The running AI image does not know {', '.join(not_running)} — deploy this commit once with "
                             "llm_feature_models empty, then rerun with it")
    return ",".join(f"{name}={model}" for name, model in pairs.items())


def parse_runtime_switches(text):
    """`KEY=VALUE;KEY=VALUE` → {키: 값}. 쌍 구분이 `;` 인 것은 카나리 계정 목록 값에 쉼표가 들어 있어서다. 앞뒤 공백은 버리고,
    빈 입력은 {} 다. `KEY=`(빈 값)은 그 키를 지운다는 뜻이다. 허용 밖 키·`=` 없음·빈 키·같은 키 두 번은 배포 실패 —
    조용히 버리면 켠 줄 알고 넘어간다. 오류에 값(계정 id)은 싣지 않는다."""
    switches = {}
    for pair in (text or "").split(";"):
        if not pair.strip():
            continue
        key, sep, value = (part.strip() for part in pair.partition("="))
        if not sep or not key:
            raise ValueError("runtime switches must be KEY=VALUE pairs separated by ';'")
        if key not in RUNTIME_SWITCHES:
            raise ValueError(f"Unsupported runtime switch {key}; use one of {', '.join(RUNTIME_SWITCHES)}")
        if key in switches:
            raise ValueError(f"Runtime switch {key} is given twice")
        switches[key] = value
    return switches


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


def require_uuid_list(values, key):
    """쉼표 구분 UUID 목록 — 비면 통과(없음). 백엔드는 항목마다 `UUID.fromString` 으로 읽고 틀리면 기동에서 죽는다."""
    listed = values.get(key, "")
    if not listed.strip():
        return
    try:
        for item in (part.strip() for part in listed.split(",")):
            # uuid.UUID 는 대시 없는 32자·중괄호·urn 접두도 받는데 백엔드(UUID.fromString)는 거기서 죽는다.
            if str(uuid.UUID(item)) != item.lower():
                raise ValueError(item)
    except ValueError:
        raise ValueError(f"{key} must be comma-separated UUIDs") from None


def validate_groups(groups):
    for group, allowed in GROUP_KEYS.items():
        values = groups[group]
        if set(values) - allowed:
            raise ValueError(f"Unsupported key in {group} secret; use deploy/eks/runtime_secrets.py allowlist")
        if any(not isinstance(value, str) or "\x00" in value for value in values.values()):
            raise ValueError(f"{group} secret values must be strings without NUL")
    backend, ai = groups["backend"], groups["ai"]
    modes = {"PLACE_GEOCODE_MODE": {"stub", "kakao"}, "WEATHER_MODE": {"fake", "kma"},
             "PUSH_MODE": {"off", "expo"}, "AI_REMINDER_COPY_MODE": {"off", "http"},
             "AFFILIATE_MODE": {"fallback", "tripcom"},
             # http = 상대 AI 해석 경계(TRIP-1410). 오타는 백엔드가 기동에서 거부하므로 배포 전에 막는다.
             "ASSISTANT_INTERPRET_MODE": {"off", "fake", "http"},
             # U10 서버 킬 스위치(REL-U10-06). 없으면 켜짐이다. 끄려면 false 를 넣고 백엔드 파드를 다시 띄운다.
             "LOCATION_AUTOMATION_ENABLED": {"true", "false"},
             # Plan-B 상황 감시(situation-awareness 설계서 §7). 없으면 off · today · off 다. 모르는 값은 백엔드가
             # 바인딩에서 기동을 거부하므로 배포 전에 막는다(대소문자·밑줄 변주도 운영 스위치로는 받지 않는다).
             "PLANB_SITUATION_SWEEP": {"off", "dry-run", "on"},
             "PLANB_SITUATION_HORIZON": {"today", "tomorrow", "pre-trip"},
             "PLANB_PREPARED_REPLAN": {"off", "on"}}
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
    # 웹 허용 출처(TRIP-1655). 백엔드는 와일드카드를 받으면 기동을 거부한다 — 파드가 뜨다 죽기 전에 여기서 막는다.
    # 비어 있거나 키가 없으면 CORS 가 꺼진 것이다(웹만 막히고 앱은 무영향).
    if "*" in backend.get("CORS_ALLOWED_ORIGINS", ""):
        raise ValueError("CORS_ALLOWED_ORIGINS must list origins one by one; a wildcard (*) is refused by the backend")
    # 생성 상한 2종(TRIP-1314)·공유 문구 하루 상한(TRIP-1411)은 없으면 백엔드 기본(10·예외 없음·30)이다. **있는데 틀리면**
    # 백엔드가 기동에서 죽는다(빈 상한·0·UUID 오타) — 파드가 뜨다 죽기 전에 여기서 막는다.
    for name in ("ITINERARY_GENERATION_DAILY_LIMIT", "SHARE_CARD_DAILY_LIMIT"):
        limit = backend.get(name)
        if limit is not None and not (limit.isascii() and limit.isdigit() and 1 <= int(limit) <= 2**31 - 1):
            raise ValueError(f"{name} must be a positive integer; remove the key to use the default")
    require_uuid_list(backend, "ITINERARY_GENERATION_LIMIT_EXEMPT_ACCOUNT_IDS")
    # 상황 감시 운영 카나리(스윕 대상 계정). 비면 전원이다 — 인가가 아니라 대상만 좁힌다(SEC-SA-04). 공백만 든 값은 '빈 값'이
    # 아니다 — 백엔드 바인딩이 [null] 로 읽어 아무 계정도 안 맞는 목록(조용히 0 여행)이 되므로 백엔드가 기동에서 거부한다.
    canary = backend.get("PLANB_SITUATION_SWEEP_ACCOUNT_IDS", "")
    if canary and not canary.strip():
        raise ValueError("PLANB_SITUATION_SWEEP_ACCOUNT_IDS must be empty or comma-separated UUIDs, not whitespace only")
    require_uuid_list(backend, "PLANB_SITUATION_SWEEP_ACCOUNT_IDS")
    # 카카오 앱 ID(TRIP-1317)는 숫자다. REST API 키(32자 hex)를 잘못 넣으면 파드는 뜨는데 **카카오 로그인이
    # 전부 401** 이 된다(발급 앱과 영영 안 맞는다) — 가장 흔한 실수라 여기서 막는다. 빈 값은 "대조 안 함"이다.
    kakao_app_id = backend.get("KAKAO_APP_ID", "")
    if kakao_app_id and not (kakao_app_id.isascii() and kakao_app_id.isdigit() and kakao_app_id[0] != "0"):
        raise ValueError("KAKAO_APP_ID must be the numeric Kakao app ID, not the REST API key")
    if backend.get("PLACE_GEOCODE_MODE") == "kakao":
        require(backend, ("KAKAO_CLIENT_ID",), "kakao geocoding")
    if backend.get("WEATHER_MODE") == "kma":
        require(backend, ("WEATHER_API",), "kma weather")
    if backend.get("AFFILIATE_MODE") == "tripcom":
        # trip_sub3(AD_ID)가 귀속의 열쇠다(probe 실측 2026-10-01) — 셋 중 하나라도 비면
        # 파드가 기동 실패로 뒤늦게 죽거나, 뜨더라도 수수료만 조용히 샌다. 배포 전에 막는다.
        require(backend, ("TRIPCOM_ALLIANCE_ID", "TRIPCOM_SID", "TRIPCOM_AD_ID"), "tripcom affiliate")
    provider = ai.get("TRIPPILOT_LLM_PROVIDER", "")
    if provider not in ("", "openai", "anthropic", "mixed"):
        raise ValueError("Unsupported TRIPPILOT_LLM_PROVIDER in ai secret")
    if provider in ("openai", "mixed"):
        require(ai, ("OPENAI_API_KEY",), "OpenAI LLM")
    if provider in ("anthropic", "mixed"):
        require(ai, ("ANTHROPIC_API_KEY",), "Anthropic LLM")
    # 도우미 오케스트레이터(assistant-orchestrator 1단계). 없으면 off = 종전 DialogueInterpreter 경로다. 오타는 AI 가
    # 기동에서 거부하므로(main.py) 파드가 뜨다 죽기 전에 여기서 막는다 — LOCATION_AUTOMATION_ENABLED 처럼 두 값만 받는다.
    if ai.get("TRIPPILOT_DIALOGUE_ORCHESTRATOR", "") not in ("", "on", "off"):
        raise ValueError("Unsupported TRIPPILOT_DIALOGUE_ORCHESTRATOR in ai secret; use on or off")
    # 공휴일 휴무(상황 감지 H1). 없으면 off = 공휴일 규칙 없음. 오타는 AI 가 기동에서 거부하므로(main.py) 같은 두 값만 받는다.
    if ai.get("HOLIDAY_CLOSURE_MODE", "") not in ("", "on", "off"):
        raise ValueError("Unsupported HOLIDAY_CLOSURE_MODE in ai secret; use on or off")
    # 섀도 분류 측정의 샘플링 비율 0~1(없으면 1.0 — DEV 전부 · 운영 0.2 권고). 범위 밖·숫자 아님은 기동 실패다.
    rate = ai.get("TRIPPILOT_DIALOGUE_SHADOW_RATE", "")
    if rate:
        try:
            parsed = float(rate)
        except ValueError:
            parsed = -1.0
        if not 0.0 <= parsed <= 1.0:  # nan 도 여기서 걸린다(비교가 전부 False)
            raise ValueError("TRIPPILOT_DIALOGUE_SHADOW_RATE must be a number from 0 to 1; remove the key to use the default")


def runtime_manifests(groups, outputs, namespace):
    # ai_kb DSN 은 임베딩과 무관하게 항상 — 도우미 세션 메모리(dialogue_memory, assistant-orchestrator FD DE §4)가
    # 그 DB 에 산다. 차트(ai.yaml)도 같은 조건(무조건)으로 꽂는다; 둘이 어긋나면 optional 아닌 secretKeyRef 라 파드가 멈춘다.
    # 장소 조회(도우미 NL2SQL)는 같은 ai_user 로 trippilot DB 의 poi_public 뷰만 읽는다(bootstrap.sql 이 권한·읽기 전용·시한을 건다).
    # 켜기는 DIALOGUE_SQL 모델 배정이다 — DSN 은 늘 꽂아 두고, 배정이 없으면 AI 가 조립하지 않는다.
    ai_password = quote(groups['database']['AI_DB_PASSWORD'], safe='')
    vector = {
        "TRIPPILOT_VECTOR_DB_URL": f"postgresql://ai_user:{ai_password}@{outputs['database_host']}:5432/ai_kb?sslmode=require",
        "TRIPPILOT_PLACE_DB_URL": f"postgresql://ai_user:{ai_password}@{outputs['database_host']}:5432/trippilot?sslmode=require",
    }
    values = {**groups, "ai": {**groups["ai"], **vector}}
    return [{"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
             "metadata": {"name": f"trippilot-{name}", "namespace": namespace},
             "stringData": values[name]} for name in GROUP_KEYS]


def open_gaps(groups):
    """배포는 되지만 **알고 있어야 하는 열린 구멍**. 막지 않는 이유는 각 줄에 있다 — 대신 배포마다 크게 말한다."""
    backend = groups["backend"]
    # 필수로 걸지 않는다: 앱 ID 를 아직 모르는 환경의 배포를 통째로 막게 된다(dev 와 출시가 같은 카카오 앱인지
    # 확인되지 않았다). 그래서 통과시키되, 빠져 있으면 조용히 넘어가지 않는다.
    # KAKAO_CLIENT_ID 를 "이 환경이 카카오를 쓴다"의 표지로 쓴다 — SDK 토큰 경로 자체는 그 값을 쓰지 않으므로
    # 근사다. 그 키 없이 SDK 로만 카카오 로그인을 받는 환경은 여기서 안 잡히고 백엔드 기동 경고만 남는다.
    if backend.get("KAKAO_CLIENT_ID") and not backend.get("KAKAO_APP_ID"):
        yield ("KAKAO_APP_ID is not set in the backend secret: Kakao SDK-token logins are NOT checked against "
               "our app, so tokens issued to other Kakao apps can sign up (TRIP-1317)")
    # 막지 않는다: 휴무(장소) 감지만으로 켜는 것도 정상 선택이다. 다만 날씨 감지기(단기예보·특보·대기질)는
    # 실 기상청일 때만 살아 있어 — 모르고 켜면 '날씨 감시'가 조용히 꺼진 채 돈다.
    if backend.get("PLANB_SITUATION_SWEEP", "off") != "off" and backend.get("WEATHER_MODE", "fake") != "kma":
        yield ("PLANB_SITUATION_SWEEP is on but WEATHER_MODE is not kma: the weather detectors (forecast, warnings, "
               "air quality) stay off, so the sweep watches closures only")


def sync(outputs, namespace, embedding_enabled, shell, *, push_mode=None, dialogue_orchestrator=None,
         llm_feature_models=None, target=None, public_data_api_key=None, runtime_switches=None):
    # embedding_enabled 는 runtime.py CLI 계약으로 남는다 — DSN 합성은 더 이상 이 값을 보지 않는다(runtime_manifests).
    region = outputs["aws_region"]
    switches = parse_runtime_switches(runtime_switches)  # 형식 오류는 시크릿을 읽기도 전에 멈춘다
    groups = {name: get_secret(shell, region, arn) for name, arn in outputs["app_secret_arns"].items()}
    # AI 그룹은 입력·대상 기본값을 먼저 얹고 검증한다 — 저장값이 틀려도 입력으로 고칠 수 있게. database·shared 는 저장값 그대로 검증
    # (seed_groups 가 database·shared 의 낯선 키를 조용히 버리고 다시 쓰는 것을 이 검증이 막는다).
    ai = dict(groups["ai"])
    for key, value in AI_TARGET_DEFAULTS.get(target, {}).items():
        if not (ai.get(key) or "").strip():  # 빈 값도 "없음" — AI 의 `_env` 도 빈 값을 미설정으로 읽는다
            ai[key] = value
    if dialogue_orchestrator is not None:
        ai["TRIPPILOT_DIALOGUE_ORCHESTRATOR"] = dialogue_orchestrator
    if llm_feature_models:
        ai["TRIPPILOT_LLM_FEATURE_MODELS"] = merge_feature_models(
            ai.get("TRIPPILOT_LLM_FEATURE_MODELS", ""), llm_feature_models, known_llm_features(),
            running_llm_features(namespace, shell))
    # 상황 감지 스위치도 사본에 먼저 얹고 검증한다(위 ai 입력과 같은 이유). 빈 값은 키를 지워 앱 기본값으로 되돌린다.
    backend = dict(groups["backend"])
    for key, value in switches.items():
        values = backend if RUNTIME_SWITCHES[key] == "backend" else ai
        if value:
            values[key] = value
        else:
            values.pop(key, None)
    candidate = {**groups, "backend": backend, "ai": ai}
    validate_groups(candidate)
    for gap in open_gaps(candidate):
        print(f"::warning title=Open security gap::{gap}")  # 실행 요약 맨 위에 주석으로 뜬다
    seeded = seed_groups(candidate)
    if push_mode is not None:
        # 배포 입력이 고른 값으로 덮는다 — 시크릿 손편집만이 켜는 길이면 로컬 자격이 만료된 날엔 못 켠다.
        # None(유지)이면 저장된 값을 건드리지 않는다(보존 규칙 그대로).
        seeded["backend"] = {**seeded["backend"], "PUSH_MODE": push_mode}
        validate_groups(seeded)
    # 공공데이터포털 키는 배포 입력이 아니라 GitHub 시크릿 → 스텝 env 로 온다(입력은 실행 화면에 보인다). 백엔드·AI 둘 다
    # 읽으므로 두 그룹에 같이 쓰고, 저장값과 다른 그룹만 덮는다. 없거나 빈 값이면 저장값을 그대로 둔다 — 지우지 않는다.
    public_data = (public_data_api_key or "").strip()
    public_data_written = [name for name in ("backend", "ai")
                           if public_data and seeded[name].get("PUBLIC_DATA_API_KEY") != public_data]
    for name in public_data_written:
        seeded[name] = {**seeded[name], "PUBLIC_DATA_API_KEY": public_data}
    if public_data_written:
        validate_groups(seeded)
    validate_rsa_key(seeded["backend"]["JWT_SIGNING_KEY"])
    for name, values in seeded.items():
        if values != groups[name]:
            put_secret(shell, region, outputs["app_secret_arns"][name], values)
    written = sorted(key for key in ai if ai[key] != groups["ai"].get(key))
    if written:
        print(f"ai secret keys written by this deploy: {', '.join(written)}")  # 이름만 — 값은 찍지 않는다
    if public_data_written:
        print(f"public data key written: {', '.join(public_data_written)}")  # 그룹 이름만 — 값은 찍지 않는다
    stored = {key: groups[group].get(key) for key, group in RUNTIME_SWITCHES.items()}
    switched = sorted(key for key, value in switches.items() if value and stored[key] != value)
    removed = sorted(key for key, value in switches.items() if not value and stored[key] is not None)
    if switched:
        print(f"runtime switches written: {', '.join(switched)}")  # 이름만 — 값(카나리 계정 id 포함)은 찍지 않는다
    if removed:
        print(f"runtime switches removed (app default): {', '.join(removed)}")
    # 도우미 경로의 백엔드 스위치(off|fake|http — 비밀 아님). AI 를 켜도 이것이 http 가 아니면 사용자는 버튼 모드다.
    print(f"backend ASSISTANT_INTERPRET_MODE={seeded['backend'].get('ASSISTANT_INTERPRET_MODE')}")
    for manifest in runtime_manifests(seeded, outputs, namespace):
        shell(["kubectl", "apply", "--server-side", "--field-manager=trippilot-runtime", "-f", "-"], json.dumps(manifest))
    # stringData 로 넣은 키는 매니페스트에서 빠져도 k8s Secret data 에 남는다(server-side apply 는 stringData 소유만 기록한다 —
    # k3s v1.35 실측). 그대로 두면 지운 스위치가 파드에서 계속 켜져 있다 → 키 이름만 실은 merge patch(null)로 지운다. 없는 키는
    # 아무 일도 없으므로 저장값에 없던 키도 보낸다 — 앞 런이 Secrets Manager 만 지우고 죽었어도 같은 입력의 재실행이 마저 지운다.
    for name in ("backend", "ai"):
        cleared = [key for key, value in switches.items() if not value and RUNTIME_SWITCHES[key] == name]
        if cleared:
            shell(["kubectl", "patch", "secret", f"trippilot-{name}", "--namespace", namespace, "--type", "merge",
                   "--patch", json.dumps({"data": dict.fromkeys(cleared)})])
