"""REMINDER_COPY 학생 모델 서빙 — Modal 서버리스 GPU 위의 vLLM.

**CI 밖 수동 배포다.** 런북 `README.md` §4 가 비워 둔 칸이 이 파일이다.

    modal deploy scripts/finetune_reminder/modal_app.py

배포 전에 §3 변환 산출물(`merged/`)을 Modal 볼륨에 올려야 한다 — 아래 §업로드.

## 왜 Modal 인가 (AWS 기각 근거, 설계문서 §서빙)

무요청 시 0원이라 "끄는 걸 잊어 예산이 새는" 사고가 구조적으로 없다. 신규 AWS
계정은 GPU 쿼터가 0 이라 증설에 며칠이 걸리고, AI 서비스는 이미 외부 LLM 을
HTTPS 로 부르므로 같은 리전 배치가 지금 얻는 이득이 없다. 실운영 전환 시
재검토 대상이고, 전환 비용은 `AI_LOCAL_LLM_BASE_URL` 한 줄이다.

## 모델 이름이 계약이다

`SERVED_NAME` 은 **반드시 `local` 로 시작**해야 앱이 로컬 라우트를 켠다
(`ai/main.py::_local_route`). 그리고 이 문자열 전체가 요청의 `model=` 필드로
그대로 나가므로 vLLM `--served-model-name` 과 정확히 일치해야 한다. 바꾸려면
`.env` 의 `AI_LLM_FEATURE_MODELS` 배정값도 같이 바꾼다.

## 업로드 (최초 1회, 그리고 모델을 새로 학습할 때마다)

    modal volume create reminder-copy-model
    modal volume put reminder-copy-model ./merged /merged

## 배포 확인 — 어댑터가 실제로 붙었는지 반드시 대조한다

파인튜닝한 가중치가 아니라 베이스 모델이 서빙돼도 **그럴듯한 답이 나와서
겉으로는 정상으로 보인다.** 실제로 로컬 검증에서 mlx 서버가 어댑터를 조용히
무시해 하루치 측정이 통째로 무효가 된 적이 있다(`docs/conventions/anti-patterns.md`).
배포 직후 아래 문장이 나오는지 본다 — 학습된 문체(`~에서 시작해 ~둘러보세요`)가
아니라 장황한 2문장이 오면 병합이 안 된 것이다.

    curl -s $URL/v1/chat/completions -H 'Content-Type: application/json' \\
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


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/models": volume},
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
    import subprocess

    subprocess.Popen(
        [
            "vllm",
            "serve",
            MODEL_DIR,
            "--served-model-name",
            SERVED_NAME,
            "--host",
            "0.0.0.0",
            "--port",
            "8000",
            # 문구 1건은 200토큰이면 충분하다. 길게 잡으면 KV 캐시만 먹는다.
            "--max-model-len",
            "2048",
        ]
    )
