"""BedrockAdapter — LlmPort 의 Bedrock Converse 구현 (파인튜닝 학생 모델 서빙).

Bedrock **Custom Model Import** 로 올린 우리 모델을 부른다. 서버리스라 무요청 시
0원이고 GPU 쿼터·상시 과금이 없다 — AWS 를 한 번 기각했던 이유 두 개를 모두
피한다(설계문서 §서빙).

클라이언트는 생성자 주입 — boto3 `bedrock-runtime` 생성은 조립 진입점 소유이고 본
모듈은 boto3 를 import 하지 않는다(`TitanEmbeddingAdapter` 와 동형, BR-U4-10).
boto3 는 프로젝트 의존성에 없다 — Bedrock 배선을 켜는 환경만 설치한다.

**Converse 를 쓰는 이유**: 아키텍처마다 다른 프롬프트 형식을 Bedrock 이 모델의
채팅 템플릿으로 감싸 준다. `InvokeModel` 로 내려가면 Qwen 의 템플릿을 우리가 직접
조립해야 하고, 그 형식은 모델을 바꾸면 같이 바뀐다. Converse 는 Qwen 아키텍처를
지원한다(Mistral·Llama·Qwen·Flan·GPTBigCode·Mixtral).

**모델 id 는 임포트된 모델의 ARN 이다** — `local*` 접두어 규칙은 게이트웨이 라우팅
키에만 적용되고(`main.py::_local_route`), 벤더로 나가는 값은 ARN 이다. 그래서 이
어댑터는 요청의 `model_id` 를 쓰지 않고 생성자가 받은 ARN 을 쓴다.
"""

from __future__ import annotations

import time

from trippilot.ports.llm_port import (
    LlmRequest,
    LlmResponse,
    LlmTimeoutError,
    LlmUnsupportedError,
)


class BedrockAdapter:
    """LlmPort Protocol 만족. `client` 는 boto3 `bedrock-runtime` 호환."""

    def __init__(self, client, model_arn: str) -> None:
        self._client = client
        self._model_arn = model_arn

    def invoke(self, request: LlmRequest) -> LlmResponse:
        if request.images:
            # 학생 모델은 텍스트 전용이다. 조용히 이미지를 버리면 호출측은 모델이
            # 사진을 봤다고 믿는다 — 그 침묵을 막는다(회고 비전 경로와 같은 이유).
            raise LlmUnsupportedError("BedrockAdapter 는 이미지 입력을 받지 않는다")

        started = time.monotonic()
        try:
            response = self._client.converse(
                modelId=self._model_arn,
                messages=[{"role": "user", "content": [{"text": request.prompt}]}],
                # temperature 는 보내지 않는다 — LlmRequest 에 필드가 없고(PR #511),
                # 모델 세대에 따라 파라미터 자체를 거부하는 사례가 있었다.
                inferenceConfig={"maxTokens": request.max_tokens},
            )
        except Exception as e:  # noqa: BLE001 — 벤더 예외 계층을 여기서 좁힌다
            # botocore 는 타임아웃을 ReadTimeoutError·ConnectTimeoutError 로 낸다.
            # 이름으로 판정한다 — botocore 를 import 하면 벤더 격리가 깨진다.
            if "Timeout" in type(e).__name__:
                raise LlmTimeoutError(str(e)) from e
            raise

        # content 는 블록 배열이고 **첫 블록이 텍스트라는 보장이 없다** — 모델이
        # 추론 블록을 먼저 낼 수 있다. 인덱스로 집으면 그 응답에서 터진다(심판
        # 채점기가 실제로 이 모양으로 죽었다, `evaluate.py` 참조).
        blocks = response["output"]["message"]["content"]
        text = next((b["text"] for b in blocks if "text" in b), "")

        usage = response.get("usage") or {}
        return LlmResponse(
            raw_text=text,
            input_tokens=int(usage.get("inputTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
            latency_ms=int((time.monotonic() - started) * 1000),
            model_id=request.model_id,
        )
