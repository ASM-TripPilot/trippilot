"""LlmPort 멀티모달 seam — 이미지 파트·동의 타입 강제·미지원 강등 (TRIP-595).

U6 Reflect FD §6.1 A안(후미 기본값 필드)의 조건 "기존 텍스트 호출 전부 무영향"을
여기서 못박고, Phase 2 파이프라인이 얹힐 세 가지 전제를 고정한다:

  ① 이미지 없는 요청은 종전과 **같은 와이어 모양**(문자열 input) — 회귀 0
  ② 이미지 있는 요청만 멀티파트로 변환 (data URL, 실측 형식 2026-08-25)
  ③ 못 받는 어댑터는 **명시 실패**(LlmUnsupportedError) — 조용히 텍스트만 보내면
     사용자는 사진을 본 회고라고 믿는다 (INV-4 침묵 금지의 이미지판)

동의 게이트는 타입으로 강제된다 — 미동의 VisionInput은 인스턴스가 될 수 없다(VIS-P1).
실 API 호출 0 (D37) — 어댑터 검증은 SDK 대역으로 한다.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from trippilot.llm_gateway.adapters.openai_adapter import _responses_input
from trippilot.domain.prompt import PromptRef
from trippilot.domain.reflection import (
    PhotoConsent,
    PhotoId,
    PhotoRef,
    VisionInput,
)
from trippilot.ports.llm_port import (
    IMAGE_MEDIA_TYPES,
    LlmImagePart,
    LlmRequest,
    LlmUnsupportedError,
)

from tests.fakes.fake_llm import TextOnlyLlm, VisionSpyLlm

_NOW = datetime(2026, 8, 28, 9, 0, tzinfo=timezone.utc)
_REF = PromptRef(prompt_id="p", version="0.1.0", feature="REFLECTION_TEMPLATE")
_PNG = b"\x89PNG\r\n\x1a\n fake bytes"


def _request(images: tuple = ()) -> LlmRequest:
    return LlmRequest(
        model_id="m", prompt="본문", prompt_ref=_REF,
        max_tokens=100, temperature=1.0, images=images,
    )


# ── ① 기존 호출 무영향 ──────────────────────────────────


def test_default_is_empty_and_wire_shape_unchanged() -> None:
    """images 미지정 = 빈 튜플, responses 입력은 종전처럼 **문자열 그대로**."""
    request = _request()
    assert request.images == ()
    assert _responses_input(request) == "본문"


# ── ② 이미지 변환 ───────────────────────────────────────


def test_images_become_multipart_data_urls() -> None:
    part = LlmImagePart(media_type="image/png", data=_PNG)
    payload = _responses_input(_request((part, part)))

    assert isinstance(payload, list) and payload[0]["role"] == "user"
    content = payload[0]["content"]
    assert content[0] == {"type": "input_text", "text": "본문"}
    assert [c["type"] for c in content[1:]] == ["input_image", "input_image"]
    expected = "data:image/png;base64," + base64.b64encode(_PNG).decode()
    assert all(c["image_url"] == expected for c in content[1:])


@given(media_type=st.sampled_from(sorted(IMAGE_MEDIA_TYPES)),
       data=st.binary(min_size=1, max_size=64))
@settings(max_examples=40, deadline=None)
def test_data_url_roundtrips_bytes(media_type: str, data: bytes) -> None:
    """어떤 바이트든 data URL에서 원본이 복원된다 — 손실·이중 인코딩 없음."""
    payload = _responses_input(_request((LlmImagePart(media_type=media_type, data=data),)))
    url = payload[0]["content"][1]["image_url"]
    prefix, encoded = url.split(",", 1)
    assert prefix == f"data:{media_type};base64"
    assert base64.b64decode(encoded) == data


def test_unsupported_media_type_and_empty_bytes_rejected_at_construction() -> None:
    """잘못된 이미지는 벤더까지 가지 않고 생성 시점에 막힌다."""
    with pytest.raises(ValueError, match="media_type"):
        LlmImagePart(media_type="image/gif", data=_PNG)
    with pytest.raises(ValueError, match="빈 이미지"):
        LlmImagePart(media_type="image/png", data=b"")


# ── ③ 미지원 어댑터 강등 신호 ────────────────────────────


def test_text_only_adapter_raises_instead_of_dropping_images() -> None:
    """이미지를 못 받으면 **명시 실패** — 텍스트만 조용히 보내지 않는다."""
    adapter = TextOnlyLlm()
    assert adapter.invoke(_request()).raw_text == "{}"  # 텍스트는 정상
    with pytest.raises(LlmUnsupportedError):
        adapter.invoke(_request((LlmImagePart(media_type="image/png", data=_PNG),)))


# ── 동의 게이트 (VIS-P1 전제) ────────────────────────────


def _consent(granted: bool = True, ref: str = "consent-1") -> PhotoConsent:
    return PhotoConsent(granted=granted, consent_ref=ref, granted_at=_NOW)


@given(granted=st.booleans(), ref=st.sampled_from(["", "   ", "consent-1"]))
@settings(max_examples=20, deadline=None)
def test_vision_input_exists_only_with_valid_consent(granted: bool, ref: str) -> None:
    """미동의·증빙 없음 조합에서는 **인스턴스 생성 자체가 불가** —
    '동의 없이는 이미지가 실리지 않는다'가 코드 경로가 아니라 타입으로 성립한다."""
    photos = (PhotoRef(photo_id=PhotoId("ph-1")),)
    if granted and ref.strip():
        assert VisionInput(photos=photos, consent=_consent(granted, ref)).photos == photos
    else:
        with pytest.raises(ValueError):
            VisionInput(photos=photos, consent=_consent(granted, ref))


def test_vision_spy_records_images_actually_sent() -> None:
    """스파이가 실제 전송 이미지를 관측한다 — 상위 파이프라인의 VIS-P1 검증 도구."""
    spy = VisionSpyLlm(canned="{}")
    spy.invoke(_request())
    spy.invoke(_request((LlmImagePart(media_type="image/jpeg", data=_PNG),)))
    assert spy.seen_images[0] == ()
    assert len(spy.seen_images[1]) == 1


def test_photo_ref_and_consent_roundtrip_and_tz_guard() -> None:
    photo = PhotoRef(photo_id=PhotoId("ph-1"), taken_at=_NOW)
    assert PhotoRef.from_dict(photo.to_dict()) == photo
    consent = _consent()
    assert PhotoConsent.from_dict(consent.to_dict()) == consent
    with pytest.raises(ValueError, match="tz-aware"):
        PhotoRef(photo_id=PhotoId("ph-1"), taken_at=datetime(2026, 8, 28))


# ── 동의 강제·트레이스 연결 (BR-U6R-09 — 게이트웨이 수준) ──────


def _facade(llm, gate=None):
    """최소 게이트웨이 — 동의 강제는 게이트 종류와 무관하다."""
    from trippilot.llm_gateway.config import C1Config
    from trippilot.llm_gateway.gateway import GatewayFacade
    from trippilot.llm_gateway.prompts import PromptRegistry
    from trippilot.domain.llm import ModelTier
    from pathlib import Path

    from tests.fakes.in_memory_trace import InMemoryTrace

    from trippilot.llm_gateway.gates.photo_highlight import PhotoHighlightGate

    trace = InMemoryTrace()
    facade = GatewayFacade(
        llm,
        PromptRegistry(Path(__file__).resolve().parent.parent / "prompts"),
        gate or PhotoHighlightGate(),
        C1Config(model_ids={ModelTier.LIGHT: "m-l", ModelTier.HEAVY: "m-h"}),
        trace,
    )
    return facade, trace


def _vision_call_args():
    """게이트웨이 호출용 (vars, context) — 프롬프트 변수 누락으로 죽지 않게 실제 빌더 사용."""
    from trippilot.llm_gateway.gates.photo_highlight import PhotoHighlightContext
    from trippilot.llm_gateway.workers.photo_highlight import (
        build_photo_highlight_vars,
    )

    vision = VisionInput(
        photos=(PhotoRef(photo_id=PhotoId("ph-1")),), consent=_consent())
    return (
        build_photo_highlight_vars(vision, limit=1),
        PhotoHighlightContext(photo_ids=frozenset({PhotoId("ph-1")}), limit=1),
    )


def test_gateway_refuses_images_without_consent_ref() -> None:
    """이미지가 벤더로 나가는 **유일한 통로**에서 동의 증빙을 요구한다 —
    워커의 타입 강제를 우회해도 여기서 막힌다. 폴백이 아니라 호출 버그(ValueError)."""
    from trippilot.domain.llm import LlmFeature
    from trippilot.domain.common import TraceId

    facade, _ = _facade(VisionSpyLlm(canned="{}"))
    part = LlmImagePart(media_type="image/png", data=_PNG)
    variables, context = _vision_call_args()

    for bad in (None, "", "   "):
        with pytest.raises(ValueError, match="consent_ref"):
            facade.call(
                LlmFeature.PHOTO_HIGHLIGHT, variables, context, TraceId("t"), _NOW,
                images=(part,), consent_ref=bad,
            )


def test_consent_ref_reaches_the_call_record() -> None:
    """법무 감사가 "이 전송은 어느 동의 근거였나"를 물으면 트레이스가 답해야 한다 —
    성공·실패(폴백) 어느 경로든 기록에 남는다 (BR-U6R-09 후반부)."""
    from trippilot.domain.llm import LlmFeature
    from trippilot.domain.common import TraceId
    from trippilot.domain.observability import LlmCallRecord

    part = LlmImagePart(media_type="image/png", data=_PNG)

    # 실패 경로 — 이미지 미지원 어댑터
    facade, trace = _facade(TextOnlyLlm())
    variables, context = _vision_call_args()
    result = facade.call(
        LlmFeature.PHOTO_HIGHLIGHT, variables, context, TraceId("t"), _NOW,
        images=(part,), consent_ref="consent-9",
    )
    assert result.is_fallback is True
    records = trace.of_type(LlmCallRecord)
    assert records and all(r.consent_ref == "consent-9" for r in records)


def test_text_calls_leave_consent_ref_empty() -> None:
    """이미지 없는 기존 호출은 None — 기록에 없던 값이 지어내지지 않는다."""
    from trippilot.domain.llm import LlmFeature
    from trippilot.domain.common import TraceId
    from trippilot.domain.observability import LlmCallRecord

    facade, trace = _facade(TextOnlyLlm())
    variables, context = _vision_call_args()
    facade.call(LlmFeature.PHOTO_HIGHLIGHT, variables, context, TraceId("t"), _NOW)
    assert all(r.consent_ref is None for r in trace.of_type(LlmCallRecord))


def test_images_are_loaded_onto_llm_request_only_inside_the_gateway() -> None:
    """동의 검사·consent_ref 계측의 우회로 차단 — LlmRequest에 images를 싣는 곳은
    게이트웨이뿐이어야 한다. 다른 곳(예: assembly_engine/llm_assembler)이 직접 실으면
    동의 없이 사진이 나갈 수 있다. 위반 시: 그 코드를 게이트웨이 경유로 바꿀 것."""
    from pathlib import Path
    import re

    src = Path(__file__).resolve().parent.parent / "src" / "trippilot"
    offenders = []
    pattern = re.compile(r"LlmRequest\([^)]*images\s*=", re.DOTALL)
    for py in src.rglob("*.py"):
        rel = py.relative_to(src).as_posix()
        if rel == "llm_gateway/gateway.py":
            continue  # 정규 통로
        if pattern.search(py.read_text(encoding="utf-8")):
            offenders.append(rel)
    assert not offenders, f"게이트웨이 밖에서 LlmRequest에 images 탑재: {offenders}"
