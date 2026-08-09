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

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
