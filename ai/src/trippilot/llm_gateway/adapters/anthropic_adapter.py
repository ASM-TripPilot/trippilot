"""AnthropicAdapter — LlmPort 플러그 (U4 FD §4, AI-D06: Anthropic API 직접).

client는 생성자 주입 — 테스트는 fake client 객체로 요청/응답 매핑만 검증하고,
실 API 스모크는 K-1(결제 승인 후). CI에서 실 호출 0건 (BR-U4-10, D37).
**client는 max_retries=0으로 생성할 것** (TRIP-381 — SDK 내부 재시도(기본 2회)가
타임아웃 계약을 3배로 왜곡, 조립 지점 책임).
SDK 타임아웃은 LlmTimeoutError로 변환, 그 외 예외는 그대로 —
게이트웨이가 폴백 신호로 수렴시킨다 (BR-U4-02).

**temperature 는 보내지 않는다** (2026-09-08). Claude 5 계열(opus-5·sonnet-5)이
`temperature=0.0` 을 400 으로 거부한다(`temperature is deprecated for this model`) —
haiku-4-5 는 받는다. 당시 게이트웨이 기본이 0.0 이라 운영 조립에서 sonnet-5·opus-5
로 가는 feature 전부(EXPLANATION·REFLECTION_TEMPLATE·PHOTO_HIGHLIGHT·_VISION)가 매번
400 → 규칙 폴백이었다. 응답은 200 이라 안 보인다. OpenAI 어댑터가 GPT-5 에서 같은
이유로 이미 뺐다(TRIP-377, #208) — 같은 처방: 결정론 의도는 이 벤더에서 실현
불가하고, 모델 기본값에 맡긴다.

그 뒤 **설정·요청 필드 자체를 걷어냈다** — 두 벤더 다 거부해 아무도 읽지 않는
값인데 살아 있는 것처럼 보여서, 결정론이 필요해지면 여기를 다시 손대게 된다.
"""

from __future__ import annotations

import base64
import time

import anthropic

from trippilot.ports.llm_port import LlmRequest, LlmResponse, LlmTimeoutError


# 기능별 effort 표(`default_feature_effort`)에는 GPT(responses `reasoning.effort`)만 받는 값이 섞여 있다 —
# `none`(사고 끄기)·`minimal`. Anthropic `output_config.effort` 는 low|medium|high|xhigh|max 만 받고
# 나머지는 400 이다(2026-10-29 운영 실측: Opus 5.5 로 돌리자 PREFERENCE_SCORING 20/20 이 400 → 규칙 폴백).
# Claude 5.5 는 사고를 끌 수 없어 low 가 가장 가까운 값이다.
_EFFORT_FLOOR = {"none": "low", "minimal": "low"}

# 서버 쪽 웹 검색 도구(anthropic SDK 0.120.2 — `anthropic.types.web_search_tool_20250305_param`).
# OpenAI responses 표면과 같은 자리(2026-10-30, PLACE_FACT_LOOKUP 벤더 폴백용 — .env.example 의
# "되살리려면 어댑터에 web_search 서버 도구를 붙이거나" 메모).
_WEB_SEARCH_TOOL = {"type": "web_search_20250305", "name": "web_search"}


def _citations(resp) -> tuple[str, ...]:
    """검색이 실제로 본·단 URL — 본문 인용(TextBlock.citations) 먼저, 그다음 검색 도구 결과
    블록(web_search_tool_result)의 목록. 순서 유지·중복 제거 — openai_adapter._citations 와 동형
    (게이트가 받는 `LlmResponse.citations` 는 벤더 무관 평평한 URL 튜플이어야 한다)."""
    cited: list[str] = []
    seen: list[str] = []
    for block in getattr(resp, "content", None) or ():
        block_type = getattr(block, "type", None)
        if block_type == "text":
            for citation in getattr(block, "citations", None) or ():
                url = getattr(citation, "url", None)
                if url:
                    cited.append(url)
        elif block_type == "web_search_tool_result":
            for result in getattr(block, "content", None) or ():
                url = getattr(result, "url", None)
                if url:
                    seen.append(url)
    urls: list[str] = []
    for url in (*cited, *seen):
        if url not in urls:
            urls.append(url)
    return tuple(urls)


def _content(request: LlmRequest):
    """messages content 조립 — 이미지 없으면 종전과 **같은 문자열**을 준다
    (기존 텍스트 호출의 와이어 모양 불변 — openai 어댑터 _responses_input과 동형).

    이미지가 있으면 블록 배열: image 블록(base64 source)들 뒤에 text 블록 —
    Anthropic 권장 순서(이미지 먼저)를 따른다. 사용자 결정(2026-09-01)으로
    vision 기능을 Claude에 배정하기 위해 미지원 명시 실패를 실제 변환으로 대체.
    """
    if not request.images:
        return request.prompt
    blocks: list = [
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": base64.b64encode(image.data).decode(),
            },
        }
        for image in request.images
    ]
    blocks.append({"type": "text", "text": request.prompt})
    return blocks


class AnthropicAdapter:
    """LlmPort Protocol 구현."""

    def __init__(self, client: anthropic.Anthropic) -> None:
        self._client = client

    def invoke(self, request: LlmRequest) -> LlmResponse:
        # effort 는 지정됐을 때만 — haiku-4-5 처럼 파라미터째 거부하는 모델이 있다.
        effort = _EFFORT_FLOOR.get(request.effort, request.effort) if request.effort else None
        extra = {"output_config": {"effort": effort}} if effort else {}
        if request.web_search:  # 벤더 쪽 검색 도구 — 2026-10-30, OpenAI responses 표면과 같은 자리
            extra["tools"] = [_WEB_SEARCH_TOOL]
        started = time.monotonic()
        try:
            resp = self._client.messages.create(
                model=request.model_id,
                max_tokens=request.max_tokens,
                # temperature 미전달 — Claude 5 계열이 파라미터째 거부(400). 모듈 docstring.
                timeout=request.timeout_sec,
                messages=[{"role": "user", "content": _content(request)}],
                **extra,
            )
        except anthropic.APITimeoutError as e:
            raise LlmTimeoutError(f"timeout > {request.timeout_sec}s: {e}") from e
        latency_ms = int((time.monotonic() - started) * 1000)
        raw_text = "".join(
            block.text
            for block in resp.content
            if getattr(block, "type", None) == "text"
        )
        return LlmResponse(
            raw_text=raw_text,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            latency_ms=latency_ms,
            model_id=resp.model,
            truncated=getattr(resp, "stop_reason", None) == "max_tokens",
            citations=_citations(resp) if request.web_search else (),
        )
