"""부하 테스트 계정의 액세스 토큰을 만든다 — 클러스터 안 Job 에서만 돈다(서명 키는 Job 밖으로 나가지 않는다).

백엔드 AccessTokenIssuer 와 같은 클레임: iss·aud·sub(=accountId)·iat·exp·jti, RS256. 서명 키는 백엔드와 같은
JWT_SIGNING_KEY(base64 PKCS#8 DER). sub 는 seed.sql 과 같은 식(md5('trippilot-loadtest-<n>')).
"""
import base64
import hashlib
import json
import os
import sys
import time
import uuid

import jwt
from cryptography.hazmat.primitives.serialization import load_der_private_key


def account_id(n: int) -> str:
    return str(uuid.UUID(hashlib.md5(f"trippilot-loadtest-{n}".encode()).hexdigest()))


def main() -> None:
    key = load_der_private_key(base64.b64decode(os.environ["JWT_SIGNING_KEY"].strip()), password=None)
    count, ttl = int(os.environ.get("ACCOUNTS", "50")), int(os.environ.get("TOKEN_TTL_S", "7200"))
    now = int(time.time())
    tokens = [
        jwt.encode({"iss": "trippilot", "aud": ["trippilot-app"], "sub": account_id(n), "iat": now, "exp": now + ttl,
                    "jti": str(uuid.uuid4())}, key, algorithm="RS256")
        for n in range(1, count + 1)
    ]
    json.dump(tokens, sys.stdout)


if __name__ == "__main__":
    main()
