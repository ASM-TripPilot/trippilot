# TripPilot AI — FastAPI 경계 서비스 (U5-03, TRIP-239)
# 이전 스텁은 stdlib만 써서 `COPY main.py` 하나로 충분했으나, main.py가
# trippilot.api 패키지와 fastapi를 import하므로 의존성·소스를 함께 넣는다.
FROM python:3.12-slim
WORKDIR /app

# CI(`uv sync --locked`)와 동일한 잠금 기반 설치 — 이미지와 테스트가 같은 버전을 쓴다.
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

# 의존성 레이어 먼저 (소스 변경이 재설치를 유발하지 않게)
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
RUN uv sync --locked --no-dev

# 런타임 자산 — c1 프롬프트 레지스트리와 의도 질문뱅크가 파일로 읽는다
COPY main.py ./
COPY prompts ./prompts
COPY data ./data
# 단가표(api/cost.py) — 이게 빠지면 TRIPPILOT_LLM_PRICE_FILE 을 꽂는 순간
# 파일 없음 → PriceConfigError → 기동 실패다(설정 오류를 은폐하지 않는 쪽 설계).
# `/app/config/llm-prices.json` = 로컬 스크립트가 `ai/` 에서 보는 것과 같은 상대경로.
COPY config ./config
# 운영 파드 안에서 kubectl exec 로 KB 적재·스모크를 돌린다 (TRIP-893).
# EKS 의 RDS·embedding 은 클러스터 밖에서 닿지 않아 이 경로가 유일하다 —
# 이게 빠지면 적재는 이미지를 다시 굽기 전까지 막힌다.
COPY scripts ./scripts

# 비루트 고정 — uid 는 차트(`deploy/eks/chart/templates/ai.yaml` 의 podSpec uid)와 **같은 값**이다.
#
# 차트는 이미 `runAsNonRoot: true` + `runAsUser: 10001` + `readOnlyRootFilesystem: true` +
# `capabilities.drop: [ALL]` 로 파드를 잠근다. 그 격리가 **차트에만** 있으면 이미지는
# 기본이 루트라, 차트를 거치지 않는 실행(로컬 `docker compose --profile full up ai`,
# 손으로 `docker run`, 다른 오케스트레이터)은 전부 루트로 돈다. 이미지 자신이 같은
# 전제를 갖게 해서 그 차이를 없앤다 — 차트는 강제하는 쪽이지 유일한 방어선이 아니다.
#
# 앱은 /app 에 아무것도 쓰지 않는다(자산은 읽기 전용, 로그는 stdout). 그래서 소유권을
# 바꾸지 않는다 — 쓰기 권한을 주는 순간 `readOnlyRootFilesystem` 과 전제가 갈린다.
USER 10001:10001

EXPOSE 8000
# venv 바이너리 직행 — `uv run` 은 읽기 전용 루트 파일시스템에서 캐시·동기화를 쓰려다 넘어진다.
# 차트가 이 이유로 command 를 덮어쓰고 있었는데(ai.yaml), 그러면 이미지 단독 실행과
# 배포가 다른 것을 돌리게 된다. 기본값을 차트가 실제로 쓰는 것과 같게 맞춘다.
CMD ["/app/.venv/bin/uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
