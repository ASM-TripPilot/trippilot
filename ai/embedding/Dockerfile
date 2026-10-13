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
# pyproject 는 사람이 읽는 명세다 — 설치는 아래 목록이 정본이라 둘이 어긋나지 않게
# 같은 커밋에서 함께 고친다(단일 파일 서비스라 잠금 파일을 두지 않는다).
COPY pyproject.toml ./
# **torch 는 CPU 전용 휠로 먼저 박는다.** 그냥 sentence-transformers 를 깔면 기본
# 인덱스의 CUDA 빌드가 딸려와 nvidia 런타임만 수 GB 다 — 실측으로 이미지가 14.8GB
# 가 됐다. 우리는 CPU encode 만 하므로(GPU 는 생성 LLM 쪽 이야기) 순수 낭비다.
RUN uv venv && uv pip install --no-cache \
      --index-url https://download.pytorch.org/whl/cpu "torch>=2.2"
RUN uv pip install --no-cache \
      "fastapi>=0.115" "uvicorn>=0.30" "sentence-transformers>=3.0"

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
# 굽고 나면 HF 캐시(fp32 원본 2.1GB)는 필요 없다 — 같은 레이어에서 지워야
# 이미지에 안 남는다. 런타임은 /models/kure 의 fp16 사본만 읽는다.
#
# **구운 뒤 권한을 연다.** safetensors 직렬화가 가중치를 `0600 root` 로 쓴다(다른 산출물은
# 0644 다). 로컬 compose 는 root 로 돌아 드러나지 않지만, 배포 차트는 비루트(uid 10001)라
# 거기서만 터진다 — 그리고 터지는 모양이 **`FileNotFoundError: No such file or directory`** 다
# (safetensors 의 `safe_open` 이 권한 거부를 그렇게 보고한다). 없는 파일을 찾게 만든다.
# 아래 검사가 재발을 빌드에서 막는다 — 런타임에 드러나면 `/health` 가 200 이라 조용하다.
RUN HF_HUB_OFFLINE=0 TRANSFORMERS_OFFLINE=0 \
    /app/.venv/bin/python bake_model.py "${EMBEDDING_MODEL}" "${EMBEDDING_REVISION}" /models/kure \
 && rm -rf /models/hf \
 && chmod -R a+rX /models/kure \
 && if find /models/kure ! -perm -o+r | grep -q .; then \
      echo "비루트가 못 읽는 산출물이 남았다:" >&2; find /models/kure ! -perm -o+r >&2; exit 1; \
    fi

# ONNX 그래프를 굽는다 — `EMBEDDING_BACKEND=onnx` 가 프로세스 안에서 이걸 읽는다
# (TRIP-965, amd64 실측 13~15% 단축). **기본 백엔드는 여전히 sentence-transformers** 라
# 이 단계는 선택지를 이미지에 넣어 두는 것이지 동작을 바꾸지 않는다.
#
# 굽는 쪽을 빌드에 두는 이유는 bake_model 과 같다 — 런타임에 만들면 파드가 뜰 때마다
# 수 분을 쓰고, 볼륨에 두면 표준 리셋 절차가 지운다.
#
# `onnxruntime` 은 런타임 의존이라 여기서 함께 깐다. `onnx` 는 **내보내기에만** 쓰이고
# 런타임에는 필요 없다(같은 레이어에서 지운다 — 200MB 급이다).
ARG EMBEDDING_BAKE_ONNX=1
COPY export_onnx.py ./
RUN if [ "${EMBEDDING_BAKE_ONNX}" = "1" ]; then \
      uv pip install --no-cache "onnx>=1.17" "onnxruntime>=1.19" && \
      /app/.venv/bin/python export_onnx.py /models/onnx && \
      uv pip uninstall onnx && \
      chmod -R a+rX /models/onnx && \
      if find /models/onnx ! -perm -o+r | grep -q .; then \
        echo "비루트가 못 읽는 ONNX 산출물이 남았다:" >&2; find /models/onnx ! -perm -o+r >&2; exit 1; \
      fi ; \
    fi
ENV EMBEDDING_ONNX_DIR=/models/onnx

COPY app.py ./

# `/ready` 가 모델 상태를 실제로 가르는지 **빌드에서** 확인한다 — 차트의 startup·readiness
# 가 이걸 보고, 틀리면 모델 없는 파드가 트래픽을 받는다(check_ready.py 의 docstring 에 경위).
COPY check_ready.py ./
RUN /app/.venv/bin/python check_ready.py

EXPOSE 8100
# 워커 1개 — 모델이 **프로세스마다 4.2 GiB** 를 잡는다(워밍 직후 4.29 · 배치 정점 4.37,
# `ai/docs/임베딩-사이징-근거.md` §2). 위의 1.1GB 는 이미지에 저장된 fp16 가중치 크기이고
# 런타임 상주가 아니다 — app.py 가 `.float()` 로 fp32 로 되올린다. 저장 크기로 계산하면
# 2워커가 2.2GB 로 보여 한도(limits 6Gi · compose mem_limit 5g) 안에 들어오는 것처럼
# 되는데, 실제로는 8.4GiB 라 OOMKilled 다. 늘리려면 한도부터 같이 올릴 것.
CMD ["/app/.venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
