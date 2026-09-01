# TripPilot 임베딩 서비스 (TRIP-517) — KURE-v1 을 AI 이미지 밖으로.
#
# ## 왜 모델을 이미지에 굽나 (볼륨이 아니라)
#
# named volume 안은 `docker compose --profile full down -v` 가 통째로 지운다
# (docs/guides/로컬-개발-컨테이너.md 의 표준 리셋 절차다). 거기 두면 팀원이 DB 를
# 리셋할 때마다 2GB 를 다시 받는다. 리포에 모델 캐시용 볼륨 선례도 없다 —
# 기존 named volume 둘은 전부 DB 데이터 디렉토리다.
#
# ## fp16 으로 구워 절반으로 (TRIP-518 실측)
#
# 업스트림은 fp32 2.1GB 다. 빌드 시점에 fp16 으로 변환해 저장하면 **1.1GB**.
# 런타임은 fp32 로 되올려 쓴다 — CPU 에 fp16 고속 경로가 없어 그대로 쓰면 19배
# 느리다. 이 왕복의 손실은 검색 순위에 영향이 없다(코사인 1.00000, top4 24/24 동일).
#
# ## 베이스는 3.11 (ai/Dockerfile 의 3.12 를 따르지 않는다)
#
# `ai/.python-version` 과 `MODULE.bazel` 의 PYTHON_VERSION 이 3.11 이고 ai 이미지만
# 3.12 로 갈라져 있다. 새로 만드는 쪽은 다수와 맞춘다.
FROM python:3.11-slim
WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /usr/local/bin/uv

# 의존성 레이어 먼저 — 모델 굽기(가장 비싼 레이어)가 앱 코드 변경에 안 씻기게.
COPY pyproject.toml ./
RUN uv venv && uv pip install --no-cache \
      fastapi>=0.115 "uvicorn>=0.30" "sentence-transformers>=3.0"

# 모델을 fp16 으로 굽는다. **리비전을 고정한다** — 업스트림이 바뀌면 적재된 벡터와
# 공간이 달라지는데, 태그만 쓰면 그게 조용히 일어난다.
ARG EMBEDDING_MODEL=nlpai-lab/KURE-v1
ARG EMBEDDING_REVISION=main
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL} \
    EMBEDDING_MODEL_PATH=/models/kure \
    HF_HOME=/models/hf \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1
COPY bake_model.py ./
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 \
    uv run python bake_model.py "${EMBEDDING_MODEL}" "${EMBEDDING_REVISION}" /models/kure

COPY app.py ./

EXPOSE 8100
# 워커 1개 — 모델이 프로세스마다 1.1GB 를 잡는다. 늘리려면 메모리부터 계산할 것.
CMD ["uv", "run", "--no-sync", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
