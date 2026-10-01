"""BedrockAdapter — LlmPort 의 Bedrock Custom Model Import 구현 (학생 모델 서빙).

Bedrock **Custom Model Import** 로 올린 우리 모델을 부른다. 서버리스라 무요청 시
0원이고 GPU 쿼터·상시 과금이 없다 — AWS 를 한 번 기각했던 이유 두 개를 모두
피한다(설계문서 §서빙).

클라이언트는 생성자 주입 — boto3 `bedrock-runtime` 생성은 조립 진입점 소유이고 본
모듈은 boto3 를 import 하지 않는다(`TitanEmbeddingAdapter` 와 동형, BR-U4-10).
boto3 는 프로젝트 의존성에 없다 — Bedrock 배선을 켜는 환경만 설치한다.

**`InvokeModel` 을 쓴다. `Converse` 는 이 모델에 안 된다** — 실측(2026-09-24):

    ValidationException: This action doesn't support the model that you provided.
    Try again with a supported text or chat model.

AWS 문서의 "Converse 는 Mistral·Llama·**Qwen**·Flan·GPTBigCode·Mixtral 을 지원한다"
는 서술과 어긋나지만, 임포트된 우리 모델(`modelArchitecture: qwen3`)에서는 거부된다.
문서를 믿고 Converse 로 쓰면 런타임에야 드러난다.

**요청·응답은 OpenAI ChatCompletion 형식이다**(실측). 임포트 시 채팅 템플릿이
모델에 함께 올라가 Bedrock 이 messages 를 알아서 감싼다 — 프롬프트를 우리가
조립하지 않는다.

    요청: {"messages": [{"role": "user", "content": ...}], "max_tokens": N}
    응답: {"choices": [{"message": {"content": ...}}],
           "usage": {"prompt_tokens": N, "completion_tokens": N}}

**모델 id 는 임포트된 모델의 ARN 이다** — `local*` 접두어 규칙은 게이트웨이 라우팅
키에만 적용되고(`main.py::_local_route`), 벤더로 나가는 값은 ARN 이다. 그래서 이
어댑터는 요청의 `model_id` 를 쓰지 않고 생성자가 받은 ARN 을 쓴다.
"""

from __future__ import annotations

import json
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

        body = json.dumps(
            {
                "messages": [{"role": "user", "content": request.prompt}],
                "max_tokens": request.max_tokens,
                # temperature 는 보내지 않는다 — LlmRequest 에 필드가 없고(PR #511),
                # 모델 세대에 따라 파라미터 자체를 거부하는 사례가 있었다.
            }
        )

        started = time.monotonic()
        try:
            response = self._client.invoke_model(
                modelId=self._model_arn,
                body=body,
                accept="application/json",
                contentType="application/json",
            )
        except Exception as e:  # noqa: BLE001 — 벤더 예외 계층을 여기서 좁힌다
            # botocore 는 타임아웃을 ReadTimeoutError·ConnectTimeoutError 로 낸다.
            # 이름으로 판정한다 — botocore 를 import 하면 벤더 격리가 깨진다.
            #
            # ModelNotReadyException 도 타임아웃으로 좁힌다: 5분 무호출이면 0으로
            # 스케일다운하고 다시 깨우는 데 수십 초가 걸린다(설계문서 §2 가 "콜드스타트
            # 직후 첫 배치는 드롭되는 게 정상"이라 한 그 창). 폴백 계단이 받아야 할
            # 일시 장애이지 설정 오류가 아니다.
            name = type(e).__name__
            if "Timeout" in name or "ModelNotReady" in name:
                raise LlmTimeoutError(str(e)) from e
            raise

        payload = json.loads(response["body"].read())

        # content 가 None 으로 오는 경우가 있다(거부·빈 생성). 빈 문자열로 수렴시키고
        # 게이트가 "빈 결과는 실패"로 처리하게 둔다(INV-4).
        choices = payload.get("choices") or []
        message = choices[0].get("message") if choices else None
        text = (message or {}).get("content") or ""

        usage = payload.get("usage") or {}
        return LlmResponse(
            raw_text=text,
            input_tokens=int(usage.get("prompt_tokens", 0)),
            output_tokens=int(usage.get("completion_tokens", 0)),
            latency_ms=int((time.monotonic() - started) * 1000),
            model_id=request.model_id,
        )
