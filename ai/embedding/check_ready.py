"""`/ready` 가 모델 상태를 실제로 가르는지 — 모델 없이 검증한다(빌드 단계에서 돈다).

## 왜 이 검사가 있나

차트의 `startupProbe`·`readinessProbe` 가 `/ready` 를 본다. 그 전에는 셋 다 `/health` 였고,
`/health` 는 **설계상 모델을 기다리지 않는다**(운영자 관측용). 그래서 가중치를 못 읽는
이미지가 `1/1 Running` 으로 떠서 `/embed` 를 전부 500 으로 돌리는데 **배포는 success** 로
끝났다(2026-10-03 DEV 실측). `startupProbe` 의 `failureThreshold: 180`(15분)도 사문이었다 —
첫 프로브에서 바로 통과했다.

## 왜 테스트 파일이 아니라 빌드 단계인가

이 서비스엔 테스트 인프라가 없고(4파일) `ai-embedding-ci` 는 이미지 빌드만 한다.
아무도 돌리지 않는 테스트를 두는 것은 없는 것보다 나쁘다 — 이 결함 자체가 "검사가
있었는데 돌지 않았다"가 아니라 "검사가 보는 신호가 틀렸다"였다.

로컬 실행: `/app/.venv/bin/python check_ready.py` (컨테이너 안) 또는
`uv run --with fastapi python check_ready.py` (리포에서).

torch 는 `app._load()` 안에서 지연 import 되므로 이 import 는 2GB 를 읽지 않는다.
"""

from __future__ import annotations

import sys

import app as m
from fastapi import HTTPException


def main() -> int:
    paths = {getattr(r, "path", None) for r in m.app.routes}
    if "/ready" not in paths:
        print("[check] /ready 라우트가 없다", file=sys.stderr)
        return 1

    # 백엔드 3종의 '로드됨' 판정이 전부 비어 있는 상태 = 오늘 DEV 에서 본 그 상태.
    m._model = m._session = m._tokenizer = None
    try:
        m.ready()
    except HTTPException as error:
        if error.status_code != 503:
            print(f"[check] 모델 미로드에서 {error.status_code} — 503 이어야 한다", file=sys.stderr)
            return 1
    else:
        print("[check] 모델 미로드인데 /ready 가 통과했다 — 프로브가 빈 파드를 받는다", file=sys.stderr)
        return 1

    # 반대편도 본다. 503 만 확인하면 **"항상 503" 인 구현도 통과**한다 — 그러면 임베딩이
    # 멀쩡한데 파드가 영원히 not-ready 로 남는다(반대 방향의 같은 사고).
    m._model = object()
    if m.BACKEND == "sentence-transformers":
        try:
            body = m.ready()
        except HTTPException as error:
            print(f"[check] 모델이 올라왔는데 /ready 가 {error.status_code} 로 거부한다", file=sys.stderr)
            return 1
        if not body.get("ready"):
            print("[check] 모델이 올라왔는데 /ready 가 ready=true 를 안 낸다", file=sys.stderr)
            return 1

    print("[check] /ready 는 모델 상태를 가른다(미로드 503 · 로드 200)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
