"""REMINDER_COPY 학생 모델 서빙 — Modal 서버리스 GPU 위의 vLLM.

**CI 밖 수동 배포다.** 런북 `README.md` §4 가 비워 둔 칸이 이 파일이다.

    modal deploy scripts/finetune_reminder/modal_app.py

배포 전에 §3 변환 산출물(`merged/`)을 Modal 볼륨에 올려야 한다 — 아래 §업로드.

## 왜 Modal 인가 (AWS 기각 근거, 설계문서 §서빙)

무요청 시 0원이라 "끄는 걸 잊어 예산이 새는" 사고가 구조적으로 없다. 신규 AWS
계정은 GPU 쿼터가 0 이라 증설에 며칠이 걸리고, AI 서비스는 이미 외부 LLM 을
HTTPS 로 부르므로 같은 리전 배치가 지금 얻는 이득이 없다. 실운영 전환 시
재검토 대상이고, 전환 비용은 `AI_LOCAL_LLM_BASE_URL` 한 줄이다.

> **2026-09-26 결정: 운영 목표는 EKS GPU 다.** 위 기각 근거 중 "끄는 걸 잊어
> 예산이 샌다"는 KEDA 가 replica 를 0 까지 내리고 Karpenter 가 노드를 반납하는
> 구성으로 막는다(`deploy/eks/chart/templates/reminder-llm.yaml`). 남은 제약은
> **신규 계정 GPU 쿼터 0**(TRIP-961)이고 리드타임이 수일이다.
>
> **이 파일은 지우지 않는다.** 쿼터가 도착할 때까지, 그리고 평가·시연이 필요할 때
> 유일하게 바로 뜨는 길이다. 전환은 `AI_LOCAL_LLM_BASE_URL` 한 줄이라 양쪽을
> 오가는 비용이 사실상 없다. 판단 기록: `ai/docs/mlops/서빙-질문과-답.md`

## 모델 이름이 계약이다

`SERVED_NAME` 은 **반드시 `local` 로 시작**해야 앱이 로컬 라우트를 켠다
(`ai/main.py::_local_route`). 그리고 이 문자열 전체가 요청의 `model=` 필드로
그대로 나가므로 vLLM `--served-model-name` 과 정확히 일치해야 한다. 바꾸려면
`.env` 의 `AI_LLM_FEATURE_MODELS` 배정값도 같이 바꾼다.

## 업로드 (최초 1회, 그리고 모델을 새로 학습할 때마다)

    modal volume create reminder-copy-model
    modal volume put reminder-copy-model ./merged /merged

## 인증 (최초 1회) — 안 하면 배포가 실패한다

    modal secret create reminder-copy-auth VLLM_API_KEY=<길고 무작위한 값>

같은 값을 `.env` 의 `AI_LOCAL_LLM_API_KEY` 에도 넣는다. Modal 웹 엔드포인트는
URL 만 알면 누구나 부르고, 스케일아웃이 자동이라 방치하면 비용 상한이 남의
요청량에 묶인다.

## 배포 확인 — 어댑터가 실제로 붙었는지 반드시 대조한다

파인튜닝한 가중치가 아니라 베이스 모델이 서빙돼도 **그럴듯한 답이 나와서
겉으로는 정상으로 보인다.** 실제로 로컬 검증에서 mlx 서버가 어댑터를 조용히
무시해 하루치 측정이 통째로 무효가 된 적이 있다(`docs/conventions/anti-patterns.md`).
배포 직후 아래 문장이 나오는지 본다 — 학습된 문체(`~에서 시작해 ~둘러보세요`)가
아니라 장황한 2문장이 오면 병합이 안 된 것이다.

    curl -s $URL/v1/chat/completions \\
      -H 'Content-Type: application/json' \\
      -H "Authorization: Bearer $VLLM_API_KEY" \\
      -d '{"model":"local-reminder-qwen3-4b-v1","temperature":0,"max_tokens":200,
           "messages":[{"role":"user","content":"<프롬프트>"}]}'
"""

from __future__ import annotations

import modal

# 런북 §4 와 `.env` 의 AI_LLM_FEATURE_MODELS 배정이 이 값을 공유한다. 셋이 어긋나면
# 앱이 로컬 라우트를 안 켜거나(접두어), vLLM 이 모델을 못 찾는다(전체 일치).
SERVED_NAME = "local-reminder-qwen3-4b-v1"

# `modal volume put` 으로 올린 병합 모델(§3 산출물)이 컨테이너 안에서 보이는 자리.
VOLUME_NAME = "reminder-copy-model"
MODEL_DIR = "/models/merged"

# 4B fp16 ≈ 8GB — T4(16GB)면 KV 캐시까지 넉넉하고 시간당 단가가 가장 싸다.
GPU = "T4"

# 콜드스타트는 무관하다: 리마인드 문구는 발송 전 백그라운드에서 채우는 배치라
# 사용자가 기다리는 경로가 아니다(설계문서 §2). 그래서 상주 컨테이너를 두지
# 않는다 — 무요청 시 0원이 이 선택의 전부다.
SCALEDOWN_SECONDS = 60

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("vllm==0.11.0", "huggingface_hub[hf_transfer]==0.35.3")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "VLLM_USE_V1": "1"})
)

app = modal.App("trippilot-reminder-copy")
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

# Modal 웹 엔드포인트는 **URL 만 알면 누구나 부른다.** 인증을 안 걸면 남의 요청이
# 우리 GPU 를 돌리고 크레딧이 소진된다 — 게다가 스케일아웃이 자동이라 비용 상한이
# 요청량에 묶인다. 앱 클라이언트는 이미 키를 보내므로(`main.py` 가
# `TRIPPILOT_LOCAL_LLM_API_KEY` 를 OpenAIAdapter 에 넘긴다) 서버만 요구하면 맞는다.
#
#     modal secret create reminder-copy-auth VLLM_API_KEY=<길고 무작위한 값>
#
# 그리고 같은 값을 `.env` 의 `AI_LOCAL_LLM_API_KEY` 에 넣는다(compose 가
# `TRIPPILOT_LOCAL_LLM_API_KEY` 로 넘긴다). 값이 어긋나면 401 이고, 401 은
# 폴백 계단이 받아 기본 상수 문구로 간다(INV-4) — 조용히 뚫리지는 않는다.
auth = modal.Secret.from_name("reminder-copy-auth")


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/models": volume},
    secrets=[auth],
    scaledown_window=SCALEDOWN_SECONDS,
    timeout=600,
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8000, startup_timeout=600)
def serve() -> None:
    """vLLM 의 OpenAI 호환 서버를 그대로 띄운다.

    앱의 로컬 라우트가 OpenAI 스키마로 말하므로 어댑터를 새로 쓸 필요가 없다 —
    `AI_LOCAL_LLM_BASE_URL` 에 이 함수의 URL + `/v1` 을 넣으면 끝이다.
    """
    import os
    import subprocess

    api_key = os.environ.get("VLLM_API_KEY")
    if not api_key:
        # 시크릿 오설정으로 인증이 꺼진 채 공개 엔드포인트가 뜨는 것을 막는다.
        # 기동 실패는 시끄럽고 배포 즉시 드러난다 — 조용히 열린 GPU 보다 낫다.
        raise RuntimeError(
            "VLLM_API_KEY 없음 — `modal secret create reminder-copy-auth "
            "VLLM_API_KEY=<값>` 을 만들지 않으면 인증 없는 GPU 엔드포인트가 열린다"
        )

    subprocess.Popen(
        [
            "vllm",
            "serve",
            MODEL_DIR,
            "--served-model-name",
            SERVED_NAME,
            "--api-key",
            api_key,
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            # 문구 1건은 200토큰이면 충분하다. 길게 잡으면 KV 캐시만 먹는다.
            "--max-model-len",
            "2048",
        ]
    )
